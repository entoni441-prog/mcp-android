// Private reverse WebSocket transport for an already-authorized XCUITest
// process. No credential storage, no background privilege, no on-device install.
import Foundation
import CryptoKit

private typealias CryptoMAC = HMAC<SHA256>

struct RunnerConfig {
    let url: URL
    let key: Data

    static func fromEnvironment() -> RunnerConfig? {
        let env = ProcessInfo.processInfo.environment
        guard let rawURL = env["IOS_UI_WS_URL"], let url = URL(string: rawURL),
              let scheme = url.scheme, scheme == "ws" || scheme == "wss",
              let host = url.host, let keyText = env["IOS_UI_RUNNER_KEY"],
              let key = Data(base64Encoded: keyText), key.count >= 32,
              url.path == "/ios/runner" else { return nil }
        // Never dial public IPs. The host must be the owner's private Tailnet.
        let octets = host.split(separator: ".").compactMap { Int($0) }
        guard octets.count == 4, octets[0] == 100, (64...127).contains(octets[1]),
              octets.allSatisfy({ (0...255).contains($0) }) else { return nil }
        return RunnerConfig(url: url, key: key)
    }

    func hmac(role: String, server: String, client: String) -> String {
        let raw = Data("\(role)|primary_iphone|\(server)|\(client)".utf8)
        var calculator = CryptoMAC(key: SymmetricKey(data: key))
        calculator.update(data: raw)
        let auth = calculator.finalize()
        return Data(auth).base64EncodedString()
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
    private var socketGeneration = 0

    init(config: RunnerConfig, perform: @escaping ([String: Any]) -> [String: Any]) {
        self.config = config
        self.perform = perform
        self.session = URLSession(configuration: .ephemeral)
    }

    func start() { connect() }

    func stop() {
        terminated = true
        authenticated = false
        socketGeneration += 1
        socket?.cancel(with: .goingAway, reason: nil)
        session.invalidateAndCancel()
    }

    private func connect() {
        guard !terminated else { return }
        authenticated = false
        socketGeneration += 1
        let generation = socketGeneration
        let ws = session.webSocketTask(with: config.url)
        socket = ws
        ws.resume()
        listen(generation)
    }

    private func retry(_ generation: Int) {
        guard !terminated && generation == socketGeneration else { return }
        authenticated = false
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        retries = min(6, retries + 1)
        let seconds = min(30, 1 << retries)
        DispatchQueue.main.asyncAfter(deadline: .now() + .seconds(seconds)) { [weak self] in
            guard let self = self, generation == self.socketGeneration else { return }
            self.connect()
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
                case .failure:
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
                  nonce.allSatisfy({ $0.isHexDigit }) else { stop(); return }
            serverNonce = nonce
            clientNonce = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
            send(["v": 1, "kind": "register", "device": "primary_iphone",
                  "nonce": clientNonce, "proof": config.hmac(role: "device", server: nonce, client: clientNonce)])
            return
        }
        if kind == "accepted" && !authenticated {
            guard let proof = message["proof"] as? String,
                  proof == config.hmac(role: "server", server: serverNonce, client: clientNonce),
                  !serverNonce.isEmpty else { stop(); return }
            authenticated = true
            retries = 0
            return
        }
        guard authenticated, kind == "command", let id = message["id"] as? String,
              id.count == 32, let op = message["op"] as? String,
              let payload = message["payload"] as? [String: Any],
              ["status", "read", "screenshot", "launch", "tap", "swipe", "type"].contains(op)
        else { return }
        let answer = perform(["op": op, "payload": payload])
        let ok = answer["ok"] as? Bool ?? false
        send(["v": 1, "kind": "result", "id": id, "ok": ok, "result": answer["result"] ?? [:]])
    }
}
