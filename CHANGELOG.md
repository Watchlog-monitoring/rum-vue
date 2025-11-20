# [1.1.0](https://github.com/Watchlog-monitoring/rum-vue/compare/1.0.0...1.1.0) (2025-11-20)


### Features

* add network features ([2f117ef](https://github.com/Watchlog-monitoring/rum-vue/commit/2f117efdc2b675d8077a8eb6410ee7a05204feb9))
* update events and CLC & INP ([067eca1](https://github.com/Watchlog-monitoring/rum-vue/commit/067eca192a732c6694dbbabf29934d558ca8e51f))

# Changelog

## 0.3.0 (2025-01-XX)

### 🚀 Major Enhancements

#### Rich Context Data
- Added comprehensive device information collection (screen, viewport, pixel ratio, color depth)
- Added browser and OS detection with version parsing
- Added network connection information (effective type, downlink, RTT, save-data mode)
- Added memory information (device memory, hardware concurrency) when available
- Added color scheme detection (dark/light mode)
- Added timezone and timezone offset tracking

#### Enhanced Performance Monitoring
- Added First Paint (FP) and First Contentful Paint (FCP) tracking
- Added complete Navigation Timing breakdown (DNS, TCP, request, response, processing, load)
- Enhanced performance metrics with domInteractive and domComplete
- Added paint metrics observer for real-time paint tracking

#### Comprehensive Error Tracking
- Added Vue error handler integration for automatic component error capture
- Added component name and props in error context
- Added source file, line number, and column number tracking
- Added error breadcrumbs for debugging context
- Enhanced error deduplication with longer window (5 seconds)

#### User Interaction Tracking
- Added click event tracking (sampled)
- Added scroll depth tracking (25%, 50%, 75%, 100%)
- Added form submission tracking
- Configurable interaction sampling rate

#### Enhanced Network Monitoring
- Added request size tracking for fetch/XHR
- Added response size tracking (decoded/encoded body sizes)
- Added transfer size tracking
- Added detailed timing breakdown (DNS, TCP, request, response)
- Enhanced URL and method tracking

#### Enhanced Resource Tracking
- Added encoded/decoded body size tracking
- Added render blocking status
- Enhanced initiator type tracking

#### Breadcrumbs System
- Added automatic breadcrumb collection for navigation, errors, and user interactions
- Configurable maximum breadcrumbs (default: 100)
- Breadcrumbs included in event context (last 20)

#### Other Improvements
- Increased buffer size from 12 to 50 events
- Enhanced session ID generation with timestamp
- Enhanced device ID generation with timestamp
- Added `captureError` method for manual error capture
- Added `addBreadcrumb` method for manual breadcrumb addition
- Improved error handling and resilience
- Better support for iOS/Safari with pagehide events

### 🔧 Configuration Options Added
- `interactionSampleRate`: Control user interaction sampling (default: 0.1)
- `captureUserInteractions`: Enable/disable user interaction tracking (default: false)
- `captureBreadcrumbs`: Enable/disable breadcrumb collection (default: true)
- `maxBreadcrumbs`: Maximum number of breadcrumbs to keep (default: 100)

### 📦 Server-Side Updates
- Updated `influxMapping.js` to support all new event types and fields
- Added support for `interaction` events
- Added support for enhanced `performance` events with paint metrics
- Added support for enhanced `network` events with size and timing data
- Added support for enhanced `resource` events
- Added support for enhanced `error` events with component context
- Added support for `FCP` and `FP` as web vitals
- Updated `RumEvent` model with additional indexes for better query performance

### 🐛 Bug Fixes
- Fixed bug in `computeNormalizedPath` where `val` was used instead of `v` for non-array params
- Improved error deduplication logic
- Better handling of edge cases in network request tracking

### 📚 Documentation
- Completely rewritten README with comprehensive feature documentation
- Added detailed event type documentation
- Added configuration options table
- Added context data structure documentation
- Added examples for all use cases

---

## 0.2.0 (Previous)

### Features
- Basic RUM tracking
- Page view tracking
- Error tracking
- Network request tracking (fetch/XHR)
- Resource tracking
- Long task tracking
- Web Vitals support (via web-vitals package)

---

## 0.1.0 (Initial Release)

### Features
- Initial release of Watchlog Vue RUM SDK
- Basic session and page view tracking
- Error monitoring
- Custom event tracking
