import Foundation
import AVFoundation

/// Records host timestamps alongside the exact native PCM frames written to disk.
/// No device-clock scheduling estimate is used as the file's origin.
final class AudioJournal: @unchecked Sendable {
    private let lock = NSLock()
    private var file: AVAudioFile?
    private(set) var rate: Double
    private var origin: Double?
    private var frames: Int64 = 0
    private var firstSampleTime: AVAudioFramePosition?
    private var entries: [[String: Any]] = []
    private var failure: String?
    init(url: URL, format: AVAudioFormat) throws {
        rate = format.sampleRate
        file = try AVAudioFile(forWriting: url, settings: [AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: format.sampleRate, AVNumberOfChannelsKey: format.channelCount, AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false], commonFormat: format.commonFormat, interleaved: format.isInterleaved)
    }
    func accept(_ buffer: AVAudioPCMBuffer, at time: AVAudioTime) {
        lock.lock(); defer { lock.unlock() }
        guard let file, failure == nil else { return }
        guard time.isHostTimeValid && time.isSampleTimeValid else { failure = "Microphone supplied no host/sample timestamp"; return }
        if firstSampleTime == nil { firstSampleTime = time.sampleTime }
        guard time.sampleTime - firstSampleTime! == frames else { failure = "Microphone sample discontinuity at file frame \(frames)"; return }
        let host = AVAudioTime.seconds(forHostTime: time.hostTime)
        if origin == nil { origin = host }
        let expected = origin! + Double(frames) / rate
        let drift = host - expected
        // Never collapse a missing buffer into seamless audio, which shifts all later dialogue.
        if abs(drift) > 0.020 { failure = "Microphone timeline discontinuity: \(drift)s at file frame \(frames)"; return }
        do {
            try file.write(from: buffer)
            entries.append(["hostTime": time.hostTime, "hostSeconds": host, "sampleTime": time.sampleTime, "sampleTimeValid": time.isSampleTimeValid, "fileStartFrame": frames, "frameCount": buffer.frameLength, "clockResidualSeconds": drift])
            frames += Int64(buffer.frameLength)
        } catch { failure = "Cannot write microphone audio: \(error.localizedDescription)" }
    }
    func fail(_ message: String) { lock.lock(); if failure == nil { failure = message }; lock.unlock() }
    func close() { lock.lock(); file = nil; lock.unlock() }
    func save(to url: URL) {
        let s = snapshot()
        var object: [String: Any] = ["sampleRate": rate, "duration": s.duration, "buffers": s.entries]
        if let origin = s.origin { object["originHostSeconds"] = origin }
        if let error = s.error { object["error"] = error }
        if let data = try? JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys]) { try? data.write(to: url, options: .atomic) }
    }
    func snapshot() -> (origin: Double?, duration: Double, entries: [[String: Any]], error: String?) {
        lock.lock(); defer { lock.unlock() }
        return (origin, Double(frames) / rate, entries, failure)
    }
}
final class MicrophoneCapture: @unchecked Sendable {
    private let engine = AVAudioEngine()
    private let lock = NSLock()
    private var stopped = false
    private var stoppedTime: Double?
    let journal: AudioJournal
    private let timelineURL: URL
    init(url: URL) throws {
        timelineURL = url.deletingLastPathComponent().appendingPathComponent("audio-timeline.json")
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { throw Failure("No microphone input format") }
        journal = try AudioJournal(url: url, format: format)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [journal] buffer, time in journal.accept(buffer, at: time) }
    }
    func start() throws { engine.prepare(); try engine.start() }
    var stoppedHostSeconds: Double? { lock.lock(); defer { lock.unlock() }; return stoppedTime }
    func stop() {
        lock.lock(); defer { lock.unlock() }
        guard !stopped else { return }; stopped = true
        engine.stop(); engine.inputNode.removeTap(onBus: 0); journal.close()
        stoppedTime = AVAudioTime.seconds(forHostTime: mach_absolute_time())
        journal.save(to: timelineURL)
    }
}
final class StopController: @unchecked Sendable {
    private let lock = NSLock()
    private var requested: Double?
    private let stopAudio: () -> Void
    init(stopAudio: @escaping () -> Void) { self.stopAudio = stopAudio }
    func stop() {
        lock.lock()
        guard requested == nil else { lock.unlock(); return }
        requested = AVAudioTime.seconds(forHostTime: mach_absolute_time())
        stopAudio()
        lock.unlock()
    }
    var requestedAt: Double? { lock.lock(); defer { lock.unlock() }; return requested }
    var stopped: Bool { requestedAt != nil }
}
