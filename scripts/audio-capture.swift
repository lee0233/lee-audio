import Foundation
import CoreAudio
import Accelerate

func diagnostic(_ message: String) { FileHandle.standardError.write(Data((message + "\n").utf8)) }
func check(_ status: OSStatus, _ operation: String) throws {
    if status != noErr { throw NSError(domain: operation, code: Int(status)) }
}
func address(_ selector: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
}
func objects(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) throws -> [AudioObjectID] {
    var a = address(selector), size: UInt32 = 0
    try check(AudioObjectGetPropertyDataSize(object, &a, 0, nil, &size), "Enumerate objects")
    var result = [AudioObjectID](repeating: 0, count: Int(size) / 4)
    try check(AudioObjectGetPropertyData(object, &a, 0, nil, &size, &result), "Read objects")
    return result
}
func stringProperty(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) throws -> String {
    var a = address(selector), size = UInt32(MemoryLayout<CFString?>.size)
    let result = UnsafeMutablePointer<CFString?>.allocate(capacity: 1)
    result.initialize(to: nil)
    defer { result.deinitialize(count: 1); result.deallocate() }
    try check(AudioObjectGetPropertyData(object, &a, 0, nil, &size, result), "Read name")
    return result.pointee as String? ?? ""
}

// Analysis runs on the IO block's serial delivery queue. No audio is saved to disk.
final class Analyzer {
    let n = 4096
    let rate: Double
    let setup: vDSP_DFT_Setup
    var left: [Float] = [], right: [Float] = []
    var window: [Float]
    var framesSinceEmission = 0
    init(rate: Double) {
        self.rate = rate
        setup = vDSP_DFT_zop_CreateSetup(nil, 4096, .FORWARD)!
        window = (0..<4096).map { Float(0.5 - 0.5 * cos(2 * Double.pi * Double($0) / 4096)) }
        left.reserveCapacity(8192); right.reserveCapacity(8192)
    }
    deinit { vDSP_DFT_DestroySetup(setup) }
    func accept(_ buffers: UnsafePointer<AudioBufferList>) {
        let list = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: buffers))
        guard let first = list.first, let data = first.mData else { return }
        let channels = Int(first.mNumberChannels)
        guard channels > 0 else { return }
        let frames = Int(first.mDataByteSize) / 4 / channels
        let a = data.assumingMemoryBound(to: Float.self)
        let b = list.count > 1 ? list[1].mData?.assumingMemoryBound(to: Float.self) : nil
        for i in 0..<frames {
            left.append(a[i * channels])
            right.append(channels > 1 ? a[i * channels + 1] : (b?[i] ?? a[i]))
        }
        framesSinceEmission += frames
        if left.count > n { left.removeFirst(left.count - n); right.removeFirst(right.count - n) }
        guard left.count == n, framesSinceEmission >= Int(rate / 30) else { return }
        framesSinceEmission = 0
        emit()
    }
    func measurements() -> [String: Any] {
        var powers = [Float](repeating: 0, count: n / 2)
        for samples in [left, right] {
            let input = zip(samples, window).map(*)
            let zero = [Float](repeating: 0, count: n)
            var real = zero, imag = zero
            vDSP_DFT_Execute(setup, input, zero, &real, &imag)
            for i in 1..<n/2 { powers[i] += (real[i]*real[i] + imag[i]*imag[i]) * 0.5 }
        }
        let centers = (0..<24).map { 63.0 * pow(12500.0 / 63.0, Double($0) / 23.0) }
        let ratio = sqrt(pow(12500.0 / 63.0, 1.0 / 23.0))
        let bands: [Double] = centers.map { center in
            let lo = max(1, Int((center / ratio) * Double(n) / rate))
            let hi = min(n/2-1, max(lo, Int((center * ratio) * Double(n) / rate)))
            if lo > hi { return 0 }
            let power = powers[lo...hi].max() ?? 0
            let amplitude = sqrt(Double(power)) * 4 / Double(n)
            return min(1, max(0, (20 * log10(max(1e-9, amplitude)) + 60) / 60))
        }
        func peak(_ s: [Float]) -> Float { s.map { abs($0) }.max() ?? 0 }
        func rms(_ s: [Float]) -> Float { sqrt(s.reduce(0) { $0 + $1*$1 } / Float(s.count)) }
        let frame: [String: Any] = ["leftPeak": peak(left), "rightPeak": peak(right),
            "leftRms": rms(left), "rightRms": rms(right), "spectrumBands": bands,
            "sampleRate": rate, "channels": 2, "source": "coreaudio",
            "timestamp": Date().timeIntervalSince1970 * 1000]
        return frame
    }
    func emit() {
        if let data = try? JSONSerialization.data(withJSONObject: measurements()) {
            FileHandle.standardOutput.write(data); FileHandle.standardOutput.write(Data([10]))
        }
    }
}

var tap = AudioObjectID(0), aggregate = AudioObjectID(0)
var proc: AudioDeviceIOProcID?
func cleanup() {
    if let proc { AudioDeviceStop(aggregate, proc); AudioDeviceDestroyIOProcID(aggregate, proc) }
    if aggregate != 0 { AudioHardwareDestroyAggregateDevice(aggregate) }
    if tap != 0 { AudioHardwareDestroyProcessTap(tap) }
}
do {
    if CommandLine.arguments.contains("--self-test") {
        let analyzer = Analyzer(rate: 48000)
        analyzer.left = (0..<4096).map { Float(0.5 * sin(2 * Double.pi * 1000 * Double($0) / 48000)) }
        analyzer.right = [Float](repeating: 0, count: 4096)
        let frame = analyzer.measurements()
        precondition(abs((frame["leftRms"] as! Float) - 0.35355) < 0.002)
        precondition((frame["rightPeak"] as! Float) == 0)
        let bands = frame["spectrumBands"] as! [Double]
        let strongest = bands.indices.max(by: { bands[$0] < bands[$1] })!
        let frequency = 63 * pow(12500.0 / 63, Double(strongest) / 23)
        precondition(abs(frequency - 1000) < 150)
        analyzer.left = [Float](repeating: 0, count: 4096)
        let silence = analyzer.measurements()
        precondition((silence["spectrumBands"] as! [Double]).allSatisfy { $0 == 0 })
        print("PASS: 1 kHz tone, stereo isolation, RMS calibration, silence")
        exit(0)
    }
    let devices = try objects(AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyDevices)
    let names = try devices.map { ($0, try stringProperty($0, kAudioObjectPropertyName)) }
    if CommandLine.arguments.contains("--list") {
        for (id, name) in names { print("\(id): \(name)") }
        exit(0)
    }
    let query = ProcessInfo.processInfo.environment["LEE_AUDIO_DEVICE"] ?? "DX5"
    let matches = names.filter { $0.1.localizedCaseInsensitiveContains(query) }
    guard matches.count == 1 else { throw NSError(domain: "Expected one output matching \(query); found \(matches.map { $0.1 }). Run --list.", code: 1) }
    let uid = try stringProperty(matches[0].0, kAudioDevicePropertyDeviceUID)
    let description = CATapDescription(excludingProcesses: [], deviceUID: uid, stream: 0)
    description.name = "LEE AUDIO meters"
    description.isPrivate = true
    description.muteBehavior = .unmuted
    try check(AudioHardwareCreateProcessTap(description, &tap), "Create tap (allow system audio capture)")
    var format = AudioStreamBasicDescription(), size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
    var a = address(kAudioTapPropertyFormat)
    try check(AudioObjectGetPropertyData(tap, &a, 0, nil, &size, &format), "Read tap format")
    guard format.mFormatID == kAudioFormatLinearPCM, format.mBitsPerChannel == 32,
          format.mFormatFlags & kAudioFormatFlagIsFloat != 0 else {
        throw NSError(domain: "Unsupported tap sample format", code: 2)
    }
    let specification: [String: Any] = [
        kAudioAggregateDeviceNameKey: "LEE AUDIO private capture",
        kAudioAggregateDeviceUIDKey: UUID().uuidString,
        kAudioAggregateDeviceIsPrivateKey: true,
        kAudioAggregateDeviceTapAutoStartKey: true,
        kAudioAggregateDeviceTapListKey: [[kAudioSubTapUIDKey: description.uuid.uuidString, kAudioSubTapDriftCompensationKey: true]]
    ]
    try check(AudioHardwareCreateAggregateDevice(specification as CFDictionary, &aggregate), "Create private capture device")
    let analyzer = Analyzer(rate: format.mSampleRate)
    try check(AudioDeviceCreateIOProcIDWithBlock(&proc, aggregate, DispatchQueue(label: "lee.audio.analysis")) { _, input, _, _, _ in
        analyzer.accept(input)
    }, "Create audio reader")
    try check(AudioDeviceStart(aggregate, proc), "Start capture")
    diagnostic("Capturing \(matches[0].1), \(format.mSampleRate) Hz; playback remains unmuted")
    signal(SIGTERM, SIG_IGN); signal(SIGINT, SIG_IGN)
    let termination = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
    let interrupt = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
    for source in [termination, interrupt] { source.setEventHandler { cleanup(); exit(0) }; source.resume() }
    // Restart cleanly after device format changes (e.g. 44.1 to 192 kHz).
    let monitor = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
        var next = AudioStreamBasicDescription(), count = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        var property = address(kAudioTapPropertyFormat)
        let status = AudioObjectGetPropertyData(tap, &property, 0, nil, &count, &next)
        if status != noErr || next.mSampleRate != format.mSampleRate || next.mChannelsPerFrame != format.mChannelsPerFrame {
            diagnostic("Audio device format changed; reconnecting")
            cleanup(); exit(0)
        }
    }
    _ = monitor
    RunLoop.main.run()
} catch { diagnostic("\(error)"); cleanup(); exit(1) }
