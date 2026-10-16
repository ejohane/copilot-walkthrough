import Foundation
import AppKit
import AVFoundation
import ScreenCaptureKit
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

func emit(_ object: [String: Any]) {
    let data = try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    FileHandle.standardOutput.write(data + Data([10]))
}
struct Failure: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}
final class StopFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var value = false
    func stop() { lock.lock(); value = true; lock.unlock() }
    var stopped: Bool { lock.lock(); defer { lock.unlock() }; return value }
}
@main struct Capture {
    @MainActor static func main() async {
        do { try await run() }
        catch { emit(["type": "error", "message": error.localizedDescription]); exit(1) }
    }
    @MainActor static func run() async throws {
        let args = Array(CommandLine.arguments.dropFirst())
        guard let command = args.first else { throw Failure("Expected permissions, windows, or record") }
        if command == "permissions" {
            // This command is explicit consent to display OS permission prompts only.
            let screen = CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess()
            let mic = await AVCaptureDevice.requestAccess(for: .audio)
            emit(["type": "permissions", "screen": screen, "microphone": mic]); return
        }
        guard CGPreflightScreenCaptureAccess() else {
            throw Failure("Screen Recording permission required. Run node record.mjs permissions, approve in System Settings, then restart your terminal if needed.")
        }
        let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
        let windows = content.windows.filter { $0.owningApplication != nil && $0.frame.width > 1 && $0.frame.height > 1 }
        if command == "windows" {
            emit(["type": "windows", "windows": windows.map { ["id": $0.windowID, "app": $0.owningApplication!.applicationName, "title": $0.title ?? ""] as [String: Any] }]); return
        }
        guard command == "record", args.count == 5, let id = UInt32(args[1]), let interval = Double(args[2]), interval.isFinite, interval > 0, let limit = Double(args[3]), limit.isFinite, limit >= 0 else {
            throw Failure("record requires window ID, positive interval, duration (0 for manual stop), output directory")
        }
        guard AVCaptureDevice.authorizationStatus(for: .audio) == .authorized else { throw Failure("Microphone permission required. Run node record.mjs permissions first.") }
        guard let window = windows.first(where: { $0.windowID == id }) else { throw Failure("Selected window is no longer available") }
        let folder = URL(fileURLWithPath: args[4], isDirectory: true)
        let recorder = try AVAudioRecorder(url: folder.appendingPathComponent("audio.wav"), settings: [AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: 16000, AVNumberOfChannelsKey: 1, AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false])
        guard recorder.prepareToRecord() else { throw Failure("Cannot prepare microphone recording") }
        let before = ProcessInfo.processInfo.systemUptime
        let deviceTime = recorder.deviceCurrentTime
        let after = ProcessInfo.processInfo.systemUptime
        let origin = (before + after) / 2 + 0.25
        guard recorder.record(atTime: deviceTime + 0.25) else { throw Failure("Cannot start microphone recording") }
        defer { recorder.stop() }
        let flag = StopFlag()
        signal(SIGINT, SIG_IGN); signal(SIGTERM, SIG_IGN)
        let interrupt = DispatchSource.makeSignalSource(signal: SIGINT, queue: .global())
        let terminate = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .global())
        interrupt.setEventHandler { flag.stop() }; terminate.setEventHandler { flag.stop() }
        interrupt.resume(); terminate.resume()
        defer { interrupt.cancel(); terminate.cancel() }
        DispatchQueue.global().async { _ = readLine(); flag.stop() }
        emit(["type": "start", "window": ["id": id, "app": window.owningApplication!.applicationName, "title": window.title ?? ""], "originUptime": origin, "audioStartUncertaintySeconds": (after - before) / 2, "startedAt": ISO8601DateFormatter().string(from: Date(timeIntervalSinceNow: origin - after))])
        let filter = SCContentFilter(desktopIndependentWindow: window)
        let config = SCStreamConfiguration()
        config.width = max(1, Int(window.frame.width * 2)); config.height = max(1, Int(window.frame.height * 2))
        config.showsCursor = false; config.ignoreShadowsSingleWindow = true
        var next = 0.0
        var index = 0
        while !flag.stopped {
            let elapsed = ProcessInfo.processInfo.systemUptime - origin
            if limit > 0 && elapsed >= limit { break }
            if elapsed > 0.1 && !recorder.isRecording { throw Failure("Microphone recording stopped unexpectedly; partial audio retained") }
            if elapsed < next {
                try await Task.sleep(nanoseconds: UInt64(min(next - elapsed, 0.05) * 1e9)); continue
            }
            let start = ProcessInfo.processInfo.systemUptime - origin
            let current = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
            guard current.windows.contains(where: { $0.windowID == id }) else { throw Failure("Selected window closed; capture stopped") }
            let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
            let end = ProcessInfo.processInfo.systemUptime - origin
            let filename = String(format: "frame-%04d.jpg", index)
            guard let destination = CGImageDestinationCreateWithURL(folder.appendingPathComponent(filename) as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else { throw Failure("Cannot create JPEG") }
            CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary)
            guard CGImageDestinationFinalize(destination) else { throw Failure("Cannot save JPEG") }
            emit(["type": "frame", "file": filename, "capturedAt": (start + end) / 2, "captureStartedAt": start, "captureCompletedAt": end])
            index += 1
            // Missed ticks are skipped, never caught up with misleading duplicate frames.
            next = (floor(end / interval) + 1) * interval
        }
        let stopBefore = ProcessInfo.processInfo.systemUptime - origin
        let audioDuration = recorder.currentTime
        recorder.stop()
        let stoppedAt = ProcessInfo.processInfo.systemUptime - origin
        emit(["type": "stop", "duration": max(0, stoppedAt), "stopRequestedAt": max(0, stopBefore), "audioDuration": audioDuration])
    }
}
