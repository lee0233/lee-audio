import Foundation
import CoreAudio

var device = AudioDeviceID(0)
var deviceAddress = AudioObjectPropertyAddress(
    mSelector: kAudioHardwarePropertyDefaultOutputDevice,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain
)
var deviceSize = UInt32(MemoryLayout<AudioDeviceID>.size)
guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &deviceAddress, 0, nil, &deviceSize, &device) == noErr else { exit(1) }

var rate = Double(0)
var rateSize = UInt32(MemoryLayout<Double>.size)
var rateAddress = AudioObjectPropertyAddress(
    mSelector: kAudioDevicePropertyNominalSampleRate,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain
)
guard AudioObjectGetPropertyData(device, &rateAddress, 0, nil, &rateSize, &rate) == noErr else { exit(1) }
var streamSize = UInt32(0)
var streamAddress = AudioObjectPropertyAddress(
    mSelector: kAudioDevicePropertyStreams,
    mScope: kAudioObjectPropertyScopeOutput,
    mElement: kAudioObjectPropertyElementMain
)
guard AudioObjectGetPropertyDataSize(device, &streamAddress, 0, nil, &streamSize) == noErr else { exit(1) }
let streamCount = Int(streamSize) / MemoryLayout<AudioStreamID>.size
var streams = Array(repeating: AudioStreamID(0), count: streamCount)
guard AudioObjectGetPropertyData(device, &streamAddress, 0, nil, &streamSize, &streams) == noErr else { exit(1) }

var channels = 0
var bits = 0
for stream in streams {
    var format: AudioStreamBasicDescription = .init()
    var formatSize = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
    var formatAddress = AudioObjectPropertyAddress(
        mSelector: kAudioStreamPropertyPhysicalFormat,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    if AudioObjectGetPropertyData(stream, &formatAddress, 0, nil, &formatSize, &format) == noErr {
        channels = max(channels, Int(format.mChannelsPerFrame))
        bits = max(bits, Int(format.mBitsPerChannel))
    }
}

guard rate > 0, channels > 0 else { exit(1) }
let roundedRate = rate.rounded() == rate ? String(Int(rate)) : String(format: "%.1f", rate)
print("{\"sampleRate\":\(roundedRate),\"bits\":\(bits),\"channels\":\(channels)}")
