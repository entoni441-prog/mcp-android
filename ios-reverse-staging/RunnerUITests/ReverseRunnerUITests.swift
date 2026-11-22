// iPhone Reverse UI STAGING: minimal owner-scoped XCUITest surface.
// This is a developer TEST runner, not a normal iOS background service.
// Does not unlock, access passcode/FaceID, change system permissions, or send chats.
import XCTest
import UIKit
import Foundation

final class ReverseRunnerUITests: XCTestCase {
    private var session: ReverseSession?

    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    func testAuthorizedRemoteSession() {
        guard let config = RunnerConfig.fromEnvironment() else {
            XCTFail("No owner-provided Tailnet endpoint and per-device pairing key")
            return
        }
        let client = ReverseSession(config: config) { [weak self] command in
            guard let self = self else { return ["ok": false, "result": ["error": "runner_unavailable"]] }
            return self.dispatch(command)
        }
        session = client
        client.start()
        // XCTest's main run loop must remain alive for Accessibility requests.
        // This test needs an external Xcode/testmanagerd launch. A Home Screen
        // tap on an ordinary host app cannot guarantee a XCTest session.
        while !client.terminated {
            RunLoop.main.run(mode: .default, before: Date(timeIntervalSinceNow: 0.12))
        }
    }

    private func allowBundle(_ value: Any?) -> String? {
        guard let bundle = value as? String,
              ["com.openai.chat", "com.anthropic.claude"].contains(bundle) else { return nil }
        return bundle
    }

    private func pass(_ result: [String: Any]) -> [String: Any] {
        return ["ok": true, "result": result]
    }

    private func fail(_ reason: String) -> [String: Any] {
        return ["ok": false, "result": ["error": reason]]
    }

    private func front(_ app: XCUIApplication) -> Bool {
        return app.state == .runningForeground
    }

    private func visibleElements(_ app: XCUIApplication) -> [[String: Any]] {
        var result = [[String: Any]]()
        for item in app.descendants(matching: .any).allElementsBoundByIndex.prefix(150) {
            guard item.exists else { continue }
            let bounds = item.frame
            if bounds.isNull || bounds.isEmpty { continue }
            let secure = item.elementType == .secureTextField
            result.append([
                "role": "\(item.elementType)",
                "label": secure ? "[secure]" : String(item.label.prefix(200)),
                "identifier": secure ? "" : String(item.identifier.prefix(120)),
                "frame": [
                    "x": Double(bounds.minX), "y": Double(bounds.minY),
                    "w": Double(bounds.width), "h": Double(bounds.height)
                ],
                "enabled": item.isEnabled,
                "value": secure ? "[redacted]" : String(describing: item.value ?? "").prefix(400).description
            ])
        }
        return result
    }

    private func queryLabel(_ app: XCUIApplication, _ label: String) -> Bool {
        if label.isEmpty || label.count > 150 { return false }
        let predicate = NSPredicate(format: "label == %@", label)
        let matches = app.descendants(matching: .any).matching(predicate)
        return matches.count == 1 && matches.firstMatch.exists
    }

    private func point(_ payload: [String: Any], x: String, y: String) -> (Double, Double)? {
        guard let xx = payload[x] as? Double, let yy = payload[y] as? Double,
              xx.isFinite, yy.isFinite,
              xx >= 0, yy >= 0,
              xx <= Double(UIScreen.main.bounds.width), yy <= Double(UIScreen.main.bounds.height)
        else { return nil }
        return (xx, yy)
    }

    private func screenPoint(_ app: XCUIApplication, _ x: Double, _ y: Double) -> XCUICoordinate {
        app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
            .withOffset(CGVector(dx: x, dy: y))
    }

    private func dispatch(_ request: [String: Any]) -> [String: Any] {
        guard let op = request["op"] as? String,
              let payload = request["payload"] as? [String: Any] else { return fail("bad_request") }
        if op == "status" {
            return pass(["runner": "active", "ui_verification": false])
        }
        if op == "screenshot" {
            guard let jpeg = XCUIScreen.main.screenshot().image.jpegData(compressionQuality: 0.48),
                  jpeg.count < 3_500_000 else { return fail("screenshot_unavailable") }
            return pass(["format": "jpeg", "base64": jpeg.base64EncodedString()])
        }
        guard let bundle = allowBundle(payload["bundle_id"]) else {
            return fail("unapproved_app")
        }
        let app = XCUIApplication(bundleIdentifier: bundle)
        if op == "launch" {
            app.activate()
            guard front(app) else { return fail("launch_not_verified") }
            return pass(["foreground": bundle, "verified": true])
        }
        guard front(app) else { return fail("not_foreground") }
        if op == "read" {
            return pass(["bundle_id": bundle, "foreground": true,
                         "nodes": visibleElements(app), "verified": true])
        }
        if op == "type" {
            guard let text = payload["text"] as? String, !text.isEmpty, text.count <= 700,
                  !text.contains("\n"), !text.contains("\r") else { return fail("unsafe_text") }
            // No send/return. Require exactly one currently visible editable target.
            let editors = (app.textFields.allElementsBoundByIndex + app.textViews.allElementsBoundByIndex)
                .filter { $0.exists && $0.isHittable && $0.isEnabled }
            guard editors.count == 1, let editor = editors.first,
                  !(editor.elementType == .secureTextField),
                  let before = editor.value as? String, before.isEmpty else {
                return fail("editable_precondition_failed")
            }
            editor.tap()
            editor.typeText(text)
            guard (editor.value as? String) == text else {
                return fail("text_outcome_unknown")
            }
            return pass(["bundle_id": bundle, "characters": text.count, "verified": true])
        }
        if op == "tap" || op == "swipe" {
            // The expected final UI state must be explicitly scoped by the
            // owner-authorized broker and checked after the one-shot gesture.
            guard let expected = payload["expected_label"] as? String,
                  !expected.isEmpty, expected.count <= 150 else { return fail("effect_required") }
            if op == "tap" {
                guard let (x,y) = point(payload, x: "x", y: "y") else { return fail("invalid_point") }
                screenPoint(app,x,y).tap()
            } else {
                guard let (x,y) = point(payload, x: "x", y: "y"),
                      let (toX,toY) = point(payload, x: "to_x", y: "to_y") else {
                    return fail("invalid_swipe")
                }
                screenPoint(app,x,y).press(forDuration: 0.1, thenDragTo: screenPoint(app,toX,toY))
            }
            guard queryLabel(app, expected) else { return fail("effect_not_verified") }
            return pass(["expected_label": expected, "verified": true])
        }
        return fail("unsupported_action")
    }
}
