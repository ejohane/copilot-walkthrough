import AppKit
import Foundation

final class Fixture: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    var label: NSTextField!
    var timer: Timer?
    var changed = false
    let session: URL
    init(session: URL) { self.session = session }
    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(contentRect: NSRect(x: 160, y: 200, width: 900, height: 540), styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = "Walkthrough acceptance — controlled window"
        window.backgroundColor = NSColor(calibratedRed: 0.14, green: 0.22, blue: 0.36, alpha: 1)
        label = NSTextField(wrappingLabelWithString: "BEFORE\nWaiting for recording…\n\nWhen this turns orange, say:\nI'm changing this now")
        label.textColor = .white; label.font = .systemFont(ofSize: 32, weight: .semibold)
        label.frame = NSRect(x: 48, y: 70, width: 800, height: 380)
        window.contentView?.addSubview(label)
        window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
        print("Controlled acceptance window ID: \(window.windowNumber)")
        fflush(stdout)
        timer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in self?.tick() }
    }
    func tick() {
        guard let bytes = try? Data(contentsOf: session.appendingPathComponent("manifest.json")), let manifest = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any], let origin = manifest["originUptime"] as? Double else { return }
        let elapsed = ProcessInfo.processInfo.systemUptime - origin
        if elapsed >= 9.75 && !changed {
            changed = true
            window.backgroundColor = NSColor(calibratedRed: 0.78, green: 0.33, blue: 0.24, alpha: 1)
            let marker: [String: Any] = ["changedAt": elapsed, "originUptime": origin, "source": "controlled native window, actual monotonic timer event"]
            if let data = try? JSONSerialization.data(withJSONObject: marker, options: [.prettyPrinted, .sortedKeys]) { try? data.write(to: session.appendingPathComponent("visual-change.json"), options: .atomic) }
        }
        label.stringValue = changed ? "AFTER\nSay now: I'm changing this now\n\nElapsed: \(String(format: "%.1f", max(0, elapsed)))s\nRecording stops at 30 seconds." : "BEFORE\nElapsed: \(String(format: "%.1f", max(0, elapsed)))s\n\nWhen this turns orange, say:\nI'm changing this now"
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}
@main struct Main {
    @MainActor static func main() {
        guard CommandLine.arguments.count == 2 else { fputs("Usage: walkthrough-fixture SESSION_FOLDER\n", stderr); exit(1) }
        let delegate = Fixture(session: URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true))
        let app = NSApplication.shared
        app.setActivationPolicy(.regular); app.delegate = delegate
        withExtendedLifetime(delegate) { app.run() }
    }
}
