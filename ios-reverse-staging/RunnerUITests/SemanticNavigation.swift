// Isolated STAGING. Reviewed catalogue stays empty until actual device AX evidence.
// Never accepts coordinates, arbitrary selectors, risk flags or app IDs for mutations.
import Foundation
import XCTest
import UIKit
import CryptoKit

final class SemanticNavigation {
    struct Rule {
        let id: String
        let bundle: String
        let before: String
        let after: String
        let buttonID: String
        let buttonLabel: String
    }
    private let rules: [String: Rule] = [:]
    private struct Observation {
        let ruleID: String
        let fingerprint: String
        let expires: TimeInterval
    }
    private var pending: [String: Observation] = [:]
    private var uncertain = false
    private func pass(_ r: [String:Any]) -> [String:Any] { ["ok":true,"result":r] }
    private func fail(_ r: String) -> [String:Any] { ["ok":false,"result":["error":r]] }
    private func stopped(_ id: String, _ reason: String) -> [String:Any] {
        pass(["verified":true,"executed":false,"rule_id":id,"reason":reason])
    }
    private func clock() -> TimeInterval { ProcessInfo.processInfo.systemUptime }

    private func screen(_ app: XCUIApplication) throws -> String? {
        guard app.state == .runningForeground else { return nil }
        let root = try app.snapshot()
        var records = [[String:String]]()
        var blocked = false
        func visit(_ n: any XCUIElementSnapshot) {
            if blocked { return }
            if records.count >= 1500 { blocked = true; return }
            if [.secureTextField,.textField,.textView,.alert,.sheet].contains(n.elementType) {
                blocked = true; return
            }
            records.append(["role":"\(n.elementType)","id":n.identifier,
                            "label":n.label,"rect":NSCoder.string(for: n.frame),
                            "enabled":String(n.isEnabled)])
            for child in n.children { visit(child) }
        }
        visit(root)
        guard !blocked, app.state == .runningForeground else { return nil }
        let bytes = try JSONSerialization.data(withJSONObject:records,options:[.sortedKeys])
        return SHA256.hash(data:bytes).map { String(format:"%02x",$0) }.joined()
    }
    private func bar(_ app: XCUIApplication, _ id: String) -> XCUIElement? {
        guard !id.isEmpty else { return nil }
        let q = app.navigationBars.matching(identifier:id)
        guard q.count == 1 else { return nil }
        let b = q.firstMatch
        guard b.exists, b.isHittable, b.identifier == id else { return nil }
        return b
    }
    private func button(_ app: XCUIApplication, _ r: Rule) -> XCUIElement? {
        guard let b = bar(app,r.before), !r.buttonID.isEmpty, !r.buttonLabel.isEmpty else { return nil }
        let q = b.buttons.matching(identifier:r.buttonID)
        guard q.count == 1 else { return nil }
        let e = q.firstMatch
        guard e.exists, e.isEnabled, e.isHittable,
              e.identifier == r.buttonID, e.label == r.buttonLabel else { return nil }
        return e
    }
    private func proof(_ r: Rule, _ marker: String, _ fingerprint: String) -> [String:Any] {
        ["verified":true,"protected":false,"foreground":true,"rule_id":r.id,
         "bundle_id":r.bundle,"screen":marker,"fingerprint":fingerprint]
    }
    func dispatch(_ op: String, _ payload: [String:Any]) -> [String:Any] {
        // Read-only structural diagnostic on a specific first-party app.
        // No launch, input, text values or password fields.
        if op == "nav_probe" {
            guard payload.isEmpty else { return fail("bad_probe") }
            let app = XCUIApplication(bundleIdentifier:"com.apple.shortcuts")
            guard let before = try? screen(app) else { return fail("probe_scope_unverified") }
            let bars = app.navigationBars.allElementsBoundByIndex.prefix(10)
            var found = [[String:Any]]()
            for b in bars where b.exists && b.isHittable {
                let buttons = b.buttons.allElementsBoundByIndex.prefix(30)
                    .filter { $0.exists && $0.isHittable && $0.isEnabled }
                    .map { ["identifier":String($0.identifier.prefix(120)),
                            "label":String($0.label.prefix(120))] }
                found.append(["identifier":String(b.identifier.prefix(120)),"buttons":buttons])
            }
            guard let after = try? screen(app), after == before else { return fail("foreground_changed") }
            return pass(["verified":true,"read_only":true,"bundle_id":"com.apple.shortcuts","bars":found])
        }
        guard !uncertain, let id = payload["rule_id"] as? String,
              let r = rules[id], r.id == id else { return fail("semantic_rule_unavailable") }
        let app = XCUIApplication(bundleIdentifier:r.bundle)
        do {
            if op == "nav_prepare" {
                guard Set(payload.keys) == Set(["rule_id"]) else { return fail("bad_prepare") }
                pending.removeAll()
                guard r.before != r.after, bar(app,r.after) == nil,
                      button(app,r) != nil, let fp = try screen(app) else { return fail("unverified_source") }
                let observation = UUID().uuidString
                pending[observation] = Observation(ruleID:id,fingerprint:fp,expires:clock()+15)
                var out = proof(r,r.before,fp)
                out["observation_id"] = observation
                return pass(out)
            }
            if op == "nav_state" {
                guard Set(payload.keys) == Set(["rule_id"]),
                      bar(app,r.before) == nil, bar(app,r.after) != nil,
                      let fp = try screen(app) else { return fail("unverified_destination") }
                return pass(proof(r,r.after,fp))
            }
            if op == "nav_execute" {
                guard Set(payload.keys) == Set(["rule_id","observation_id","fingerprint"]),
                      let observation = payload["observation_id"] as? String,
                      let fp = payload["fingerprint"] as? String,
                      let old = pending.removeValue(forKey:observation),
                      old.ruleID == id, old.fingerprint == fp, old.expires > clock() else {
                    return stopped(id,"stale_observation")
                }
                pending.removeAll()
                guard bar(app,r.after) == nil, let e = button(app,r),
                      let fresh = try screen(app), fresh == fp,
                      app.state == .runningForeground,
                      e.exists, e.isHittable, e.isEnabled,
                      e.identifier == r.buttonID, e.label == r.buttonLabel else {
                    return stopped(id,"protected_or_changed")
                }
                uncertain = true
                e.tap()
                guard bar(app,r.after) != nil, bar(app,r.before) == nil,
                      let post = try screen(app), post != fp else { return fail("outcome_unknown") }
                uncertain = false
                var out = proof(r,r.after,post)
                out["executed"] = true
                return pass(out)
            }
            return fail("unsupported_navigation_op")
        } catch { return fail("navigation_snapshot_failed") }
    }
}
