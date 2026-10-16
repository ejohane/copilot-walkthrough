import Foundation
import AppKit
import AVFoundation
import ScreenCaptureKit
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers
import CoreMedia
import CoreImage

func emit(_ object: [String: Any]) {
    let data = try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    FileHandle.standardOutput.write(data + Data([10]))
}
struct Failure: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
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
        let microphone = try MicrophoneCapture(url: folder.appendingPathComponent("audio.wav"))
        let flag = StopController { microphone.stop() }
        signal(SIGINT, SIG_IGN); signal(SIGTERM, SIG_IGN)
        let interrupt = DispatchSource.makeSignalSource(signal: SIGINT, queue: .global())
        let terminate = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .global())
        interrupt.setEventHandler { flag.stop() }; terminate.setEventHandler { flag.stop() }
        interrupt.resume(); terminate.resume()
        defer { interrupt.cancel(); terminate.cancel(); microphone.stop() }
        try microphone.start()
        DispatchQueue.global().async { _ = readLine(); flag.stop() }
        let startup = AVAudioTime.seconds(forHostTime: mach_absolute_time())
        while microphone.journal.snapshot().origin == nil {
            if flag.stopped { throw Failure("Stopped before first microphone sample") }
            if let error = microphone.journal.snapshot().error { throw Failure(error) }
            if AVAudioTime.seconds(forHostTime: mach_absolute_time()) - startup > 5 { throw Failure("No microphone samples within five seconds") }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        let origin = microphone.journal.snapshot().origin!
        let deadline = DispatchSource.makeTimerSource(queue: .global())
        if limit > 0 {
            let remaining = max(0, origin + limit - AVAudioTime.seconds(forHostTime: mach_absolute_time()))
            deadline.schedule(deadline: .now() + remaining)
            deadline.setEventHandler { flag.stop() }
        }
        deadline.resume()
        defer { deadline.cancel() }
        var timebase = mach_timebase_info_data_t()
        mach_timebase_info(&timebase)
        emit(["type": "start", "hostTimebase": ["numerator": timebase.numer, "denominator": timebase.denom], "window": ["id": id, "app": window.owningApplication!.applicationName, "title": window.title ?? ""], "originUptime": origin, "audioClock": "first AVAudioEngine input sample AVAudioTime.hostTime, mach absolute seconds", "startedAt": ISO8601DateFormatter().string(from: Date(timeIntervalSinceNow: origin - AVAudioTime.seconds(forHostTime: mach_absolute_time())))])
        let filter = SCContentFilter(desktopIndependentWindow: window)
        let config = SCStreamConfiguration()
        config.width = max(1, Int(window.frame.width * 2)); config.height = max(1, Int(window.frame.height * 2))
        config.showsCursor = false; config.ignoreShadowsSingleWindow = true
        let audioWatchdog = DispatchSource.makeTimerSource(queue: .global())
        audioWatchdog.schedule(deadline: .now() + 0.1, repeating: 0.1)
        audioWatchdog.setEventHandler {
            if flag.stopped { return }
            let snapshot = microphone.journal.snapshot()
            if snapshot.error != nil { flag.stop(); return }
            if AVAudioTime.seconds(forHostTime: mach_absolute_time()) - origin - snapshot.duration > 0.5 {
                microphone.journal.fail("Microphone supplied no samples for over 500ms")
                flag.stop()
            }
        }
        audioWatchdog.resume()
        defer { audioWatchdog.cancel() }
        let imageContext = CIContext()
        var next = 0.0
        var lastTimestamp = -Double.infinity
        var index = 0
        while !flag.stopped {
            let elapsed = AVAudioTime.seconds(forHostTime: mach_absolute_time()) - origin
            if limit > 0 && elapsed >= limit { flag.stop(); break }
            if let error = microphone.journal.snapshot().error { throw Failure(error) }
            if elapsed < next {
                try await Task.sleep(nanoseconds: UInt64(min(next - elapsed, 0.05) * 1e9)); continue
            }
            let current = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
            if flag.stopped { break }
            guard current.windows.contains(where: { $0.windowID == id }) else { throw Failure("Selected window closed; capture stopped") }
            let start = AVAudioTime.seconds(forHostTime: mach_absolute_time()) - origin
            let sample = try await SCScreenshotManager.captureSampleBuffer(contentFilter: filter, configuration: config)
            let end = AVAudioTime.seconds(forHostTime: mach_absolute_time()) - origin
            // An in-flight OS capture cannot be cancelled. Discard its result after stop.
            if flag.stopped { break }
            guard let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]], let display = attachments.first?[.displayTime] as? NSNumber, let pixel = CMSampleBufferGetImageBuffer(sample) else { throw Failure("Screenshot lacks native display timestamp or pixel data") }
            let timestamp = AVAudioTime.seconds(forHostTime: display.uint64Value) - origin
            let presentation = CMSampleBufferGetPresentationTimeStamp(sample).seconds
            if timestamp < 0 || timestamp <= lastTimestamp {
                emit(["type": "skippedFrame", "reason": "stale or pre-session native display timestamp", "displayedAt": timestamp, "captureStartedAt": start, "captureCompletedAt": end])
                next = (floor(end / interval) + 1) * interval
                continue
            }
            guard timestamp <= end + 0.020 else { throw Failure("Screenshot host clock is inconsistent with microphone host clock") }
            let ciImage = CIImage(cvPixelBuffer: pixel)
            guard let image = imageContext.createCGImage(ciImage, from: ciImage.extent) else { throw Failure("Cannot convert screenshot pixels") }
            let filename = String(format: "frame-%04d.jpg", index)
            guard let destination = CGImageDestinationCreateWithURL(folder.appendingPathComponent(filename) as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else { throw Failure("Cannot create JPEG") }
            CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary)
            guard CGImageDestinationFinalize(destination) else { throw Failure("Cannot save JPEG") }
            var event: [String: Any] = ["type": "frame", "file": filename, "capturedAt": timestamp, "sourceDisplayHostTime": display.uint64Value, "captureStartedAt": start, "captureCompletedAt": end]
            if presentation.isFinite { event["presentationTimeSeconds"] = presentation }
            emit(event)
            lastTimestamp = timestamp
            index += 1
            // Missed ticks are skipped, never caught up with misleading duplicate frames.
            next = (floor(end / interval) + 1) * interval
        }
        flag.stop()
        let audio = microphone.journal.snapshot()
        if let error = audio.error { throw Failure(error) }
        let journal: [String: Any] = ["originHostSeconds": origin, "sampleRate": microphone.journal.rate, "duration": audio.duration, "buffers": audio.entries]
        let data = try JSONSerialization.data(withJSONObject: journal, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: folder.appendingPathComponent("audio-timeline.json"), options: .atomic)
        emit(["type": "stop", "duration": audio.duration, "stopRequestedAt": max(0, (flag.requestedAt ?? origin) - origin), "audioDuration": audio.duration, "audioTimeline": "audio-timeline.json", "recordingStoppedAt": (microphone.stoppedHostSeconds ?? origin) - origin])
    }
}
