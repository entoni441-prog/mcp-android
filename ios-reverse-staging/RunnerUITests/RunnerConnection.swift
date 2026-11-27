import Foundation
import CryptoKit
import Security

private typealias CryptoMAC = HMAC<SHA256>

struct RunnerConfig {
    let url: URL
    let key: Data
    let persistRequested: Bool

    private struct Stored: Codable {
        let url: String
        let key: Data
    }

    private static let service = "org.entoni.iosstaging.native-bootstrap"
    private static let account = "authorized-reverse-session-v1"

    private static var item: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: account]
    }

    private static func validated(_ rawURL: String, _ key: Data, persist: Bool) -> RunnerConfig? {
        guard let url = URL(string: rawURL),
              let scheme = url.scheme, scheme == "ws" || scheme == "wss",
              let host = url.host, key.count >= 32,
              url.path == "/ios/runner", url.user == nil, url.password == nil,
              url.query == nil, url.fragment == nil else { return nil }
        let octets = host.split(separator: ".").compactMap { Int($0) }
        guard octets.count == 4, octets[0] == 100, (64...127).contains(octets[1]),
              octets.allSatisfy({ (0...255).contains($0) }) else { return nil }
        return RunnerConfig(url: url, key: key, persistRequested: persist)
    }

    static func fromEnvironment() -> RunnerConfig? {
        let env = ProcessInfo.processInfo.environment
        if env["IOS_UI_CLEAR_CONFIG"] == "1" {
            let status = SecItemDelete(item as CFDictionary)
            NSLog("[IOS_NATIVE_STAGING] config_clear_status=%d", status)
            return nil
        }
        let rawURL = env["IOS_UI_WS_URL"]
        let keyText = env["IOS_UI_RUNNER_KEY"]
        if rawURL != nil || keyText != nil {
            guard let rawURL = rawURL, let keyText = keyText,
                  let key = Data(base64Encoded: keyText),
                  let config = validated(rawURL, key, persist: env["IOS_UI_PERSIST_CONFIG"] == "1") else {
                NSLog("[IOS_NATIVE_STAGING] explicit_config_rejected")
                return nil
            }
            NSLog("[IOS_NATIVE_STAGING] explicit_config_valid")
            return config
        }
        var query = item
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var output: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &output)
        guard status == errSecSuccess, let data = output as? Data,
              let stored = try? JSONDecoder().decode(Stored.self, from: data),
              let config = validated(stored.url, stored.key, persist: false) else {
            NSLog("[IOS_NATIVE_STAGING] stored_config_unavailable_status=%d", status)
            return nil
        }
        NSLog("[IOS_NATIVE_STAGING] stored_config_valid")
        return config
    }

    // Only called after mutual HMAC acceptance on an explicitly requested provisioning run.
    // No pairing file, Apple password, URL or key is written to diagnostic logs.
    func persistAfterAuthentication() {
        guard persistRequested,
              let data = try? JSONEncoder().encode(Stored(url: url.absoluteString, key: key)) else { return }
        let attrs: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        ]
        var status = SecItemUpdate(Self.item as CFDictionary, attrs as CFDictionary)
        if status == errSecItemNotFound {
            var add = Self.item
            for (k, v) in attrs { add[k] = v }
            status = SecItemAdd(add as CFDictionary, nil)
        }
        NSLog("[IOS_NATIVE_STAGING] config_persist_status=%d", status)
    }

    func hmac(role: String, server: String, client: String) -> String {
        let raw = Data("\(role)|primary_iphone|\(server)|\(client)".utf8)
        var calculator = CryptoMAC(key: SymmetricKey(data: key))
        calculator.update(data: raw)
        let signatureBytes = calculator.finalize()
        return Data(signatureBytes).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

final class ReverseSession {
    private let config: RunnerConfig
    private let perform: ([String: Any]) -> [String: Any]
    private let session: URLSession
    private var socket: URLSessionWebSocketTask?
    private var serverNonce = ""
    private var clientNonce = ""
    private(set) var authenticated = false
    private(set) var terminated = false
    private var retries = 0
    private var persistAttempted = false
    private var socketGeneration = 0
    private var pingTicket = 0
    private var seen = [String: [String: Any]]()
    private var recent = [String]()
    // Only touched on the main thread: network callbacks enqueue; XCTest loop executes.
    private var pendingCommands = [[String: Any]]()

    init(config: RunnerConfig, perform: @escaping ([String: Any]) -> [String: Any]) {
        self.config = config
        self.perform = perform
        self.session = URLSession(configuration: .ephemeral)
    }

    func start() { connect() }

    func stop() {
        terminated = true
        authenticated = false
        pendingCommands.removeAll()
        socketGeneration += 1
        socket?.cancel(with: .goingAway, reason: nil)
        session.invalidateAndCancel()
    }

    private func connect() {
        guard !terminated else { return }
        authenticated = false
        pendingCommands.removeAll()
        socketGeneration += 1
        let generation = socketGeneration
        let ws = session.webSocketTask(with: config.url)
        socket = ws
        NSLog("[IOS_NET_STAGING] websocket_resume_generation=%d", generation)
        ws.resume()
        listen(generation)
        // Do not issue WebSocket PING before HTTP Upgrade and HMAC acceptance.
    }

    private func retry(_ generation: Int) {
        guard !terminated && generation == socketGeneration else { return }
        authenticated = false
        socketGeneration += 1
        let next = socketGeneration
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        retries = min(6, retries + 1)
        NSLog("[IOS_NET_STAGING] retry_generation=%d retries=%d", generation, retries)
        let seconds = min(30, 1 << retries)
        DispatchQueue.main.asyncAfter(deadline: .now() + .seconds(seconds)) { [weak self] in
            guard let self = self, next == self.socketGeneration else { return }
            self.connect()
        }
    }

    private func heartbeat(_ generation: Int) {
        guard !terminated, generation == socketGeneration, let ws = socket else { return }
        pingTicket += 1
        let ticket = pingTicket
        ws.sendPing { [weak self] error in
            DispatchQueue.main.async {
                guard let self = self, generation == self.socketGeneration else { return }
                if let error = error {
                    let ns = error as NSError
                    NSLog("[IOS_NET_STAGING] ping_failure domain=%@ code=%ld", ns.domain, ns.code)
                    self.retry(generation)
                }
                else if self.pingTicket == ticket { self.pingTicket = 0 }
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 10) { [weak self] in
            guard let self = self, generation == self.socketGeneration else { return }
            if self.pingTicket == ticket { self.retry(generation) }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 15) { [weak self] in
            self?.heartbeat(generation)
        }
    }

    private func listen(_ generation: Int) {
        guard !terminated, generation == socketGeneration, let ws = socket else { return }
        ws.receive { [weak self] result in
            DispatchQueue.main.async {
                guard let self = self, generation == self.socketGeneration else { return }
                switch result {
                case .success(let message):
                    switch message {
                    case .string(let text):
                        if let data = text.data(using: .utf8),
                           let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                            self.consume(parsed)
                        } else { self.retry(generation); return }
                    default: self.retry(generation); return
                    }
                    self.listen(generation)
                case .failure(let error):
                    let ns = error as NSError
                    NSLog("[IOS_NET_STAGING] receive_failure domain=%@ code=%ld", ns.domain, ns.code)
                    self.retry(generation)
                }
            }
        }
    }

    private func send(_ value: [String: Any]) {
        guard let ws = socket, let data = try? JSONSerialization.data(withJSONObject: value),
              data.count <= 5_200_000, let text = String(data: data, encoding: .utf8) else { return }
        let generation = socketGeneration
        ws.send(.string(text)) { [weak self] error in
            if error != nil {
                DispatchQueue.main.async { self?.retry(generation) }
            }
        }
    }

    private func consume(_ message: [String: Any]) {
        guard message["v"] as? Int == 1, let kind = message["kind"] as? String else { return }
        if kind == "challenge" && !authenticated {
            guard let nonce = message["nonce"] as? String, nonce.count == 32,
                  message["device"] as? String == "primary_iphone",
                  nonce.allSatisfy({ $0.isHexDigit }) else { retry(socketGeneration); return }
            serverNonce = nonce
            clientNonce = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
            send(["v": 1, "kind": "register", "device": "primary_iphone",
                  "nonce": clientNonce, "proof": config.hmac(role: "device", server: nonce, client: clientNonce)])
            return
        }
        if kind == "accepted" && !authenticated {
            guard let proof = message["proof"] as? String,
                  proof == config.hmac(role: "server", server: serverNonce, client: clientNonce),
                  !serverNonce.isEmpty else { retry(socketGeneration); return }
            authenticated = true
            if !persistAttempted {
                persistAttempted = true
                config.persistAfterAuthentication()
            }
            retries = 0
            NSLog("[IOS_NET_STAGING] hmac_accepted_heartbeat_enabled")
            heartbeat(socketGeneration)
            return
        }
        guard authenticated, kind == "command", let id = message["id"] as? String,
              id.count == 32 else { return }
        if let prior = seen[id] { send(prior); return }
        // No XCUI operation in this DispatchQueue.main.async network callback.
        pendingCommands.append(message)
        let op = String((message["op"] as? String ?? "unknown").prefix(24))
        NSLog("[IOS_AX_STAGING] cmd_received op=%@", op)
    }

    // Called from XCTest's own test loop, AFTER RunLoop.main.run has returned.
    // It remains on the main actor but is not nested inside a GCD main block.
    func processOneQueuedCommandOnTestThread() {
        guard authenticated, !terminated, !pendingCommands.isEmpty else { return }
        let message = pendingCommands.removeFirst()
        guard let id = message["id"] as? String else { return }
        if let prior = seen[id] { send(prior); return }
        let operations = ["status","read","screenshot","launch","tap","swipe","type"]
        let op = String((message["op"] as? String ?? "unknown").prefix(24))
        var answer: [String: Any] = ["ok": false, "result": ["error":"unsupported_command"]]
        NSLog("[IOS_AX_STAGING] xcui_begin op=%@", op)
        let started = CFAbsoluteTimeGetCurrent()
        if operations.contains(op), let payload = message["payload"] as? [String: Any] {
            answer = perform(["op":op,"payload":payload])
        }
        let elapsed = Int((CFAbsoluteTimeGetCurrent() - started) * 1000)
        NSLog("[IOS_AX_STAGING] xcui_done op=%@ elapsed_ms=%d", op, elapsed)
        let success = answer["ok"] as? Bool ?? false
        let response: [String: Any] = ["v":1,"kind":"result","id":id,
                "ok":success,"result":answer["result"] ?? [:]]
        seen[id] = response
        recent.append(id)
        if recent.count > 256 { seen.removeValue(forKey: recent.removeFirst()) }
        NSLog("[IOS_AX_STAGING] result op=%@ ok=%d", op, success ? 1 : 0)
        send(response)
    }
}
