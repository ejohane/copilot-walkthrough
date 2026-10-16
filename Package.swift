// swift-tools-version: 5.9
import PackageDescription
import Foundation
let info = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Config/CaptureInfo.plist").path
let package = Package(name: "WalkthroughCapture", platforms: [.macOS(.v14)], products: [
    .executable(name: "walkthrough-capture", targets: ["WalkthroughCapture"]),
    .executable(name: "walkthrough-fixture", targets: ["WalkthroughFixture"])
], targets: [
    .executableTarget(name: "WalkthroughCapture", linkerSettings: [.unsafeFlags(["-Xlinker", "-sectcreate", "-Xlinker", "__TEXT", "-Xlinker", "__info_plist", "-Xlinker", info])]),
    .executableTarget(name: "WalkthroughFixture"),
    .testTarget(name: "WalkthroughCaptureTests", dependencies: ["WalkthroughCapture"])
])
