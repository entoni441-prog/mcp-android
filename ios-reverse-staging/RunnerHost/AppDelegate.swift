import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let view = UIViewController()
        view.view.backgroundColor = .systemBackground
        let label = UILabel()
        label.translatesAutoresizingMaskIntoConstraints = false
        label.numberOfLines = 0
        label.textAlignment = .center
        label.text = "iPhone Reverse UI STAGING\nUnsigned developer test host only.\nNo background automation in this app."
        view.view.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: view.view.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: view.view.centerYAnchor),
            label.leadingAnchor.constraint(greaterThanOrEqualTo: view.view.leadingAnchor, constant: 24),
            label.trailingAnchor.constraint(lessThanOrEqualTo: view.view.trailingAnchor, constant: -24)
        ])
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = view
        window.makeKeyAndVisible()
        self.window = window
        return true
    }
}
