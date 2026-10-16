import XCTest
import AVFoundation
@testable import WalkthroughCapture

final class AudioTimingTests: XCTestCase {
    func buffer(_ format: AVAudioFormat, count: UInt32 = 480) -> AVAudioPCMBuffer {
        let b = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: count)!
        b.frameLength = count
        for i in 0..<Int(count) { b.floatChannelData![0][i] = 0.1 }
        return b
    }
    func testNativePCMFileUsesFirstSampleHostOriginAndContiguousSampleOffsets() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("audio-journal-\(UUID().uuidString).wav")
        defer { try? FileManager.default.removeItem(at: url) }
        let format = AVAudioFormat(standardFormatWithSampleRate: 48000, channels: 1)!
        let journal = try AudioJournal(url: url, format: format)
        for index in 0..<4 {
            let seconds = 100 + Double(index) * 0.01
            let time = AVAudioTime(hostTime: AVAudioTime.hostTime(forSeconds: seconds), sampleTime: Int64(index * 480), atRate: 48000)
            journal.accept(buffer(format), at: time)
        }
        journal.close()
        let s = journal.snapshot()
        XCTAssertNil(s.error); XCTAssertEqual(s.origin!, 100, accuracy: 0.000001)
        XCTAssertEqual(s.duration, 0.04, accuracy: 0.000001)
        XCTAssertEqual(s.entries.count, 4)
        XCTAssertEqual(s.entries[3]["fileStartFrame"] as? Int64, 1440)
        // Read the actual native file through AVFoundation, independently of journal counters.
        let retained = try AVAudioFile(forReading: url)
        XCTAssertEqual(retained.length, 1920)
        XCTAssertEqual(retained.fileFormat.sampleRate, 48000)
    }
    func testMissingBufferFailsInsteadOfDeletingTimeFromLaterSpeech() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("audio-gap-\(UUID().uuidString).wav")
        defer { try? FileManager.default.removeItem(at: url) }
        let format = AVAudioFormat(standardFormatWithSampleRate: 48000, channels: 1)!
        let journal = try AudioJournal(url: url, format: format)
        journal.accept(buffer(format), at: AVAudioTime(hostTime: AVAudioTime.hostTime(forSeconds: 100), sampleTime: 0, atRate: 48000))
        journal.accept(buffer(format), at: AVAudioTime(hostTime: AVAudioTime.hostTime(forSeconds: 100.11), sampleTime: 5280, atRate: 48000))
        journal.close()
        XCTAssertTrue(journal.snapshot().error!.contains("discontinuity"))
        XCTAssertEqual(journal.snapshot().entries.count, 1)
        XCTAssertEqual(try AVAudioFile(forReading: url).length, 480)
    }
    func testInvalidHostTimeCannotProduceAssumedOrigin() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("audio-clock-\(UUID().uuidString).wav")
        defer { try? FileManager.default.removeItem(at: url) }
        let format = AVAudioFormat(standardFormatWithSampleRate: 48000, channels: 1)!
        let journal = try AudioJournal(url: url, format: format)
        journal.accept(buffer(format), at: AVAudioTime(sampleTime: 0, atRate: 48000))
        journal.close()
        XCTAssertNil(journal.snapshot().origin)
        XCTAssertEqual(journal.snapshot().duration, 0)
        XCTAssertNotNil(journal.snapshot().error)
    }
    func testStopLatchesTimestampAndStopsAudioOnceWithoutWaitingForScreen() {
        var stopped = 0
        let controller = StopController { stopped += 1 }
        let before = AVAudioTime.seconds(forHostTime: mach_absolute_time())
        controller.stop()
        let after = AVAudioTime.seconds(forHostTime: mach_absolute_time())
        let first = controller.requestedAt!
        controller.stop()
        XCTAssertEqual(stopped, 1); XCTAssertEqual(controller.requestedAt, first)
        XCTAssertGreaterThanOrEqual(first, before); XCTAssertLessThanOrEqual(first, after)
    }
}

extension AudioTimingTests {
    func testOneTenMillisecondBufferMissingIsDetectedEvenBelowHostDriftTolerance() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("short-gap-\(UUID().uuidString).wav")
        defer { try? FileManager.default.removeItem(at: url) }
        let format = AVAudioFormat(standardFormatWithSampleRate: 48000, channels: 1)!
        let journal = try AudioJournal(url: url, format: format)
        journal.accept(buffer(format), at: AVAudioTime(hostTime: AVAudioTime.hostTime(forSeconds: 100), sampleTime: 0, atRate: 48000))
        journal.accept(buffer(format), at: AVAudioTime(hostTime: AVAudioTime.hostTime(forSeconds: 100.02), sampleTime: 960, atRate: 48000))
        journal.close()
        XCTAssertTrue(journal.snapshot().error!.contains("sample discontinuity"))
        XCTAssertEqual(try AVAudioFile(forReading: url).length, 480)
    }
}
