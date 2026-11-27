// Isolated STAGING. Reviewed catalogue stays empty until actual device AX evidence.
// Never accepts coordinates, arbitrary selectors, risk flags or app IDs for mutations.
import Foundation
import XCTest
import UIKit
import CryptoKit

final class SemanticNavigation {
    struct Selector {
        let role: XCUIElement.ElementType
        let identifier: String
        let label: String
    }
    struct Rule {
        let id: String
        let bundle: String
        let before: String
        let after: String
        let beforeMarker: Selector
        let afterMarker: Selector
        let target: Selector
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
    // A selector belongs to a reviewed rule, never to the remote request.
    // Custom navigation controls need not be descendants of UINavigationBar.
    private func unique(_ app: XCUIApplication, _ selector: Selector, target: Bool = false) -> XCUIElement? {
        guard app.state == .runningForeground,
              !selector.identifier.isEmpty || !selector.label.isEmpty,
              [.button,.cell,.link,.navigationBar,.staticText,.tabBar].contains(selector.role) else { return nil }
        if target && ![.button,.cell,.link].contains(selector.role) { return nil }
        let query = app.descendants(matching:selector.role)
            .matching(NSPredicate(format:"identifier == %@ AND label == %@",selector.identifier,selector.label))
        guard query.count == 1 else { return nil }
        let e = query.firstMatch
        guard e.exists, e.identifier == selector.identifier, e.label == selector.label,
              !e.frame.isEmpty, e.frame.intersects(UIScreen.main.bounds) else { return nil }
        if target && (!e.isHittable || !e.isEnabled) { return nil }
        return e
    }
    private func source(_ app: XCUIApplication, _ r: Rule) -> Bool {
        unique(app,r.beforeMarker) != nil && unique(app,r.afterMarker) == nil
    }
    private func destination(_ app: XCUIApplication, _ r: Rule) -> Bool {
        unique(app,r.afterMarker) != nil && unique(app,r.beforeMarker) == nil
    }
    private func button(_ app: XCUIApplication, _ r: Rule) -> XCUIElement? {
        guard source(app,r) else { return nil }
        return unique(app,r.target,target:true)
    }
    // Diagnostic candidates only: this vocabulary cannot authorize a touch.
    private let probeLabels: Set<String> = [
        "Back","Settings","General","About","Shortcuts","All Shortcuts","Automation","Gallery","Done","Cancel",
        "Назад","Настройки","Основные","Об этом устройстве","Команды","Все команды","Автоматизация","Галерея","Готово","Отмена",
        "Indietro","Impostazioni","Generali","Info","Comandi","Tutti i comandi","Automazione","Galleria","Fine","Annulla"
    ]
    private func structuralNodes(_ app: XCUIApplication) throws -> [[String:String]] {
        let root = try app.snapshot()
        var out = [[String:String]]()
        var visited = 0
        var blocked = false
        func visit(_ n: any XCUIElementSnapshot) {
            if blocked { return }
            visited += 1
            if visited > 1500 { blocked = true; return }
            if n.elementType == .secureTextField { blocked = true; return }
            let role: String
            switch n.elementType {
            case .button: role = "button"
            case .cell: role = "cell"
            case .link: role = "link"
            case .navigationBar: role = "navigationBar"
            case .staticText: role = "staticText"
            case .tabBar: role = "tabBar"
            default: role = ""
            }
            if !role.isEmpty && out.count < 50 && n.isEnabled &&
                !n.frame.isEmpty && n.frame.intersects(UIScreen.main.bounds) &&
                (probeLabels.contains(n.label) || probeLabels.contains(n.identifier)) &&
                n.label.count <= 120 && n.identifier.count <= 120 {
                // Return only exact known navigation labels, not user-entered values.
                if (n.label.isEmpty || probeLabels.contains(n.label)) &&
                   !n.identifier.lowercased().contains("password") {
                    out.append(["role":role,"identifier":n.identifier,"label":n.label])
                }
            }
            for child in n.children { visit(child) }
        }
        visit(root)
        guard !blocked else { throw NSError(domain:"SemanticNavigation",code:1) }
        return out
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
            let allowed = ["com.apple.shortcuts","com.apple.Preferences"]
            let active = allowed.filter { XCUIApplication(bundleIdentifier:$0).state == .runningForeground }
            guard active.count == 1, let bundle = active.first else { return fail("probe_scope_unverified") }
            let app = XCUIApplication(bundleIdentifier:bundle)
            guard let before = try? screen(app), let nodes = try? structuralNodes(app) else { return fail("probe_scope_unverified") }
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
            return pass(["verified":true,"read_only":true,"bundle_id":bundle,"bars":found,"nodes":nodes])
        }
        guard !uncertain, let id = payload["rule_id"] as? String,
              let r = rules[id], r.id == id else { return fail("semantic_rule_unavailable") }
        let app = XCUIApplication(bundleIdentifier:r.bundle)
        do {
            if op == "nav_prepare" {
                guard Set(payload.keys) == Set(["rule_id"]) else { return fail("bad_prepare") }
                pending.removeAll()
                guard r.before != r.after, source(app,r),
                      button(app,r) != nil, let fp = try screen(app) else { return fail("unverified_source") }
                let observation = UUID().uuidString
                pending[observation] = Observation(ruleID:id,fingerprint:fp,expires:clock()+15)
                var out = proof(r,r.before,fp)
                out["observation_id"] = observation
                return pass(out)
            }
            if op == "nav_state" {
                guard Set(payload.keys) == Set(["rule_id"]),
                      destination(app,r),
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
                guard source(app,r), let e = button(app,r),
                      let fresh = try screen(app), fresh == fp,
                      app.state == .runningForeground,
                      e.exists, e.isHittable, e.isEnabled,
                      e.identifier == r.target.identifier, e.label == r.target.label else {
                    return stopped(id,"protected_or_changed")
                }
                uncertain = true
                e.tap()
                guard destination(app,r),
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
