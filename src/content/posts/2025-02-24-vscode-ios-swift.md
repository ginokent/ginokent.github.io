---
title: "VSCode で iOS 向け Swift 開発時にエラー Cannot load underlying module for 'UIKit' が出る"
description: "VSCode で iOS 向け Swift 開発をしようとして、 SourceKit に `Cannot load underlying module for 'UIKit'` などと言われた人向けのメモ書き。"
publishedAt: 2025-02-24T09:00:00+09:00
updatedAt: 2026-01-12T09:00:00+09:00
tags: ["iOS", "Swift", "VS Code"]
---

VSCode で iOS 向け Swift 開発をしようとして、 SourceKit に `Cannot load underlying module for 'UIKit'` などと言われた人向けのメモ書き。

## settings.json に設定を追加

`18.1` となっている箇所は適宜変更してください。

```json .vscode/settings.json
{
    "swift.swiftSDK": "/Applications/Xcode.app/Contents/Developer/Platforms/iPhoneSimulator.platform/Developer/SDKs/iPhoneSimulator18.1.sdk",
    "swift.sourcekit-lsp.serverArguments": [
        "-Xswiftc",
        "-sdk",
        "-Xswiftc",
        "/Applications/Xcode.app/Contents/Developer/Platforms/iPhoneSimulator.platform/Developer/SDKs/iPhoneSimulator18.1.sdk",
        "-Xswiftc",
        "-target",
        "-Xswiftc",
        "arm64-apple-ios18.1-simulator"
    ]
}
```

## 執筆時の環境

```console
$ code --version
1.97.2
e54c774e0add60467559eb0d1e229c6452cf8447
arm64

$ code --list-extensions --show-versions | grep swift
swiftlang.swift-vscode@2.0.2

$ swift --version
swift-driver version: 1.115 Apple Swift version 6.0.2 (swiftlang-6.0.2.1.2 clang-1600.0.26.4)
Target: arm64-apple-macosx15.0

$ xcodebuild -version
Xcode 16.1
Build version 16B40

$ xcrun simctl list runtimes
== Runtimes ==
iOS 18.1 (18.1 - 22B81) - com.apple.CoreSimulator.SimRuntime.iOS-18-1

$ LANG=C date
Mon Feb 24 04:50:52 JST 2025
```
