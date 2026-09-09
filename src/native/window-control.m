#import <Cocoa/Cocoa.h>
#import <ApplicationServices/ApplicationServices.h>
#include <node_api.h>

// Retain the actual accessibility object, never look up a window by title.
static AXUIElementRef savedWindow = NULL;
static void cleanup(void *unused) { if (savedWindow) CFRelease(savedWindow); savedWindow = NULL; }
static napi_value fail(napi_env env, const char *message) { napi_throw_error(env, NULL, message); return NULL; }
static bool minimized(AXUIElementRef window) {
  CFTypeRef value = NULL;
  bool result = AXUIElementCopyAttributeValue(window, kAXMinimizedAttribute, &value) == kAXErrorSuccess && value && CFEqual(value, kCFBooleanTrue);
  if (value) CFRelease(value);
  return result;
}
static napi_value control(napi_env env, napi_callback_info info) {
  @autoreleasepool {
    size_t argc = 2; napi_value argv[2];
    napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
    char action[32] = {0}, target[32] = {0};
    if (argc < 1 || napi_get_value_string_utf8(env, argv[0], action, sizeof(action), NULL) != napi_ok) return fail(env, "Missing window action.");
    if (argc > 1) napi_get_value_string_utf8(env, argv[1], target, sizeof(target), NULL);
    bool restoring = strcmp(action, "restore") == 0;
    bool minimizing = strcmp(action, "minimize") == 0;
    bool maximizing = strcmp(action, "maximize") == 0;
    if (!restoring && !minimizing && !maximizing) return fail(env, "Unsupported window action.");
    if (!AXIsProcessTrusted()) return fail(env, "Enable Accessibility for Dex to control windows.");
    AXUIElementRef window = NULL;
    if (restoring || strcmp(target, "last_minimized") == 0) {
      if (!savedWindow) return fail(env, "Dex has no remembered minimized window in this app run. Name the app to open it.");
      window = (AXUIElementRef)CFRetain(savedWindow);
    } else {
      AXUIElementRef system = AXUIElementCreateSystemWide();
      CFTypeRef focusedApp = NULL;
      if (AXUIElementCopyAttributeValue(system, kAXFocusedApplicationAttribute, &focusedApp) == kAXErrorSuccess && focusedApp) {
        AXUIElementCopyAttributeValue((AXUIElementRef)focusedApp, kAXFocusedWindowAttribute, (CFTypeRef *)&window);
        CFRelease(focusedApp);
      }
      CFRelease(system);
    }
    if (!window) return fail(env, "No controllable window is focused.");
    AXUIElementSetMessagingTimeout(window, 1.0);
    pid_t pid = 0; AXError pidError = AXUIElementGetPid(window, &pid);
    if (pidError != kAXErrorSuccess || pid <= 0 || ![NSRunningApplication runningApplicationWithProcessIdentifier:pid]) {
      CFRelease(window); return fail(env, "That window is no longer available.");
    }
    if (pid == getpid()) { CFRelease(window); return fail(env, "Dex itself is focused. Focus the intended app or name it first."); }
    AXError error = kAXErrorSuccess;
    if (minimizing || restoring || minimized(window)) {
      error = AXUIElementSetAttributeValue(window, kAXMinimizedAttribute, minimizing ? kCFBooleanTrue : kCFBooleanFalse);
      if (error != kAXErrorSuccess) {
        CFRelease(window); return fail(env, "The window did not accept its minimized state change.");
      }
    }
    if (minimizing) {
      if (savedWindow) CFRelease(savedWindow);
      savedWindow = (AXUIElementRef)CFRetain(window);
    } else {
      NSRunningApplication *app = [NSRunningApplication runningApplicationWithProcessIdentifier:pid];
      [app activateWithOptions:0];
      error = AXUIElementPerformAction(window, kAXRaiseAction);
      if (error != kAXErrorSuccess) { CFRelease(window); return fail(env, "The window was restored but could not be brought forward."); }
    }
    if (maximizing) {
      CFTypeRef oldPosition = NULL, oldSize = NULL;
      CGPoint point = CGPointZero; CGSize size = CGSizeZero;
      AXUIElementCopyAttributeValue(window, kAXPositionAttribute, &oldPosition);
      AXUIElementCopyAttributeValue(window, kAXSizeAttribute, &oldSize);
      if (oldPosition && CFGetTypeID(oldPosition) == AXValueGetTypeID()) AXValueGetValue(oldPosition, kAXValueCGPointType, &point);
      if (oldSize && CFGetTypeID(oldSize) == AXValueGetTypeID()) AXValueGetValue(oldSize, kAXValueCGSizeType, &size);
      if (oldPosition) CFRelease(oldPosition); if (oldSize) CFRelease(oldSize);
      CGFloat desktopTop = NSScreen.screens.firstObject.frame.size.height;
      NSPoint center = NSMakePoint(point.x + size.width / 2, desktopTop - point.y - size.height / 2);
      NSScreen *screen = NSScreen.mainScreen;
      for (NSScreen *candidate in NSScreen.screens) if (NSPointInRect(center, candidate.frame)) { screen = candidate; break; }
      NSRect visible = screen.visibleFrame;
      point = CGPointMake(visible.origin.x, desktopTop - NSMaxY(visible));
      size = CGSizeMake(visible.size.width, visible.size.height);
      AXValueRef positionValue = AXValueCreate(kAXValueCGPointType, &point), sizeValue = AXValueCreate(kAXValueCGSizeType, &size);
      AXError moved = AXUIElementSetAttributeValue(window, kAXPositionAttribute, positionValue);
      AXError resized = AXUIElementSetAttributeValue(window, kAXSizeAttribute, sizeValue);
      CFRelease(positionValue); CFRelease(sizeValue);
      if (moved != kAXErrorSuccess || resized != kAXErrorSuccess) { CFRelease(window); return fail(env, "The window was brought forward but does not support the requested size or position."); }
    }
    CFRelease(window);
    napi_value result; napi_get_boolean(env, true, &result); return result;
  }
}
static napi_value savedMinimized(napi_env env, napi_callback_info info) {
  if (!savedWindow) return fail(env, "No remembered window.");
  CFTypeRef value = NULL;
  AXError error = AXUIElementCopyAttributeValue(savedWindow, kAXMinimizedAttribute, &value);
  if (error != kAXErrorSuccess || !value) return fail(env, "The remembered window is no longer accessible.");
  bool state = CFEqual(value, kCFBooleanTrue); CFRelease(value);
  napi_value result; napi_get_boolean(env, state, &result); return result;
}
// Resolve canonical app paths so colloquial names do not silently fail in open(1).
static NSString *stringArg(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value arg; char value[4096] = {0};
  napi_get_cb_info(env, info, &argc, &arg, NULL, NULL);
  if (!argc || napi_get_value_string_utf8(env, arg, value, sizeof(value), NULL) != napi_ok) return nil;
  return [NSString stringWithUTF8String:value];
}
static napi_value appPath(napi_env env, napi_callback_info info) {
  @autoreleasepool {
    NSString *name = stringArg(env, info);
    if (!name.length) return fail(env, "Missing application name.");
    NSString *path = nil;
    for (NSRunningApplication *app in NSWorkspace.sharedWorkspace.runningApplications) {
      if ([app.localizedName caseInsensitiveCompare:name] == NSOrderedSame ||
          [app.bundleIdentifier.pathExtension caseInsensitiveCompare:name] == NSOrderedSame) {
        if (app.activationPolicy == NSApplicationActivationPolicyRegular) { path = app.bundleURL.path; break; }
      }
    }
    if (!path) path = [NSWorkspace.sharedWorkspace fullPathForApplication:name];
    if (!path && [name caseInsensitiveCompare:@"Chrome"] == NSOrderedSame)
      path = [NSWorkspace.sharedWorkspace fullPathForApplication:@"Google Chrome"];
    if (!path) return fail(env, "Could not find that installed application.");
    napi_value result; napi_create_string_utf8(env, path.UTF8String, NAPI_AUTO_LENGTH, &result); return result;
  }
}
static napi_value activateApp(napi_env env, napi_callback_info info) {
  @autoreleasepool {
    NSString *path = stringArg(env, info);
    if (!path) return fail(env, "Missing application path.");
    NSRunningApplication *app = nil;
    for (NSRunningApplication *candidate in NSWorkspace.sharedWorkspace.runningApplications)
      if ([candidate.bundleURL.path.stringByStandardizingPath isEqualToString:path.stringByStandardizingPath]) { app = candidate; break; }
    if (!app) return fail(env, "The application has not finished launching.");
    [app unhide]; [app activateWithOptions:0];
    AXUIElementRef application = AXUIElementCreateApplication(app.processIdentifier);
    AXUIElementSetMessagingTimeout(application, 0.5);
    AXUIElementRef window = NULL;
    AXUIElementCopyAttributeValue(application, kAXFocusedWindowAttribute, (CFTypeRef *)&window);
    if (!window) AXUIElementCopyAttributeValue(application, kAXMainWindowAttribute, (CFTypeRef *)&window);
    if (!window) {
      CFArrayRef windows = NULL;
      AXUIElementCopyAttributeValue(application, kAXWindowsAttribute, (CFTypeRef *)&windows);
      if (windows && CFArrayGetCount(windows)) window = (AXUIElementRef)CFRetain(CFArrayGetValueAtIndex(windows, 0));
      if (windows) CFRelease(windows);
    }
    if (window) {
      if (minimized(window)) AXUIElementSetAttributeValue(window, kAXMinimizedAttribute, kCFBooleanFalse);
      AXUIElementSetAttributeValue(window, kAXMainAttribute, kCFBooleanTrue);
      AXUIElementPerformAction(window, kAXRaiseAction);
      CFRelease(window);
    }
    CFRelease(application);
    napi_value result; napi_create_int32(env, app.processIdentifier, &result); return result;
  }
}
static napi_value appVisible(napi_env env, napi_callback_info info) {
  @autoreleasepool {
    size_t argc = 1; napi_value arg; int32_t pid = 0;
    napi_get_cb_info(env, info, &argc, &arg, NULL, NULL);
    if (!argc || napi_get_value_int32(env, arg, &pid) != napi_ok) return fail(env, "Missing application identity.");
    bool visible = false;
    if (NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier == pid) {
      AXUIElementRef application = AXUIElementCreateApplication(pid), window = NULL;
      AXUIElementSetMessagingTimeout(application, 0.5);
      AXUIElementCopyAttributeValue(application, kAXFocusedWindowAttribute, (CFTypeRef *)&window);
      if (window && !minimized(window)) {
        CFTypeRef position = NULL, size = NULL;
        CGPoint point = CGPointZero; CGSize dimensions = CGSizeZero;
        AXUIElementCopyAttributeValue(window, kAXPositionAttribute, &position);
        AXUIElementCopyAttributeValue(window, kAXSizeAttribute, &size);
        bool boundsKnown = position && size && CFGetTypeID(position) == AXValueGetTypeID() && CFGetTypeID(size) == AXValueGetTypeID() &&
          AXValueGetValue(position, kAXValueCGPointType, &point) && AXValueGetValue(size, kAXValueCGSizeType, &dimensions);
        if (position) CFRelease(position); if (size) CFRelease(size);
        NSArray *onScreen = CFBridgingRelease(CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, kCGNullWindowID));
        for (NSDictionary *entry in onScreen) {
          CGRect bounds = CGRectZero;
          if (boundsKnown && [entry[(__bridge NSString *)kCGWindowOwnerPID] intValue] == pid && [entry[(__bridge NSString *)kCGWindowLayer] intValue] == 0 &&
              [entry[(__bridge NSString *)kCGWindowAlpha] doubleValue] > 0 && CGRectMakeWithDictionaryRepresentation((__bridge CFDictionaryRef)entry[(__bridge NSString *)kCGWindowBounds], &bounds) &&
              fabs(bounds.origin.x-point.x)<2 && fabs(bounds.origin.y-point.y)<2 && fabs(bounds.size.width-dimensions.width)<2 && fabs(bounds.size.height-dimensions.height)<2) { visible = true; break; }
        }
      }
      if (window) CFRelease(window); CFRelease(application);
    }
    napi_value result; napi_get_boolean(env, visible, &result); return result;
  }
}
// Normal application termination lets the app present save/download prompts.
// Never force-terminate, synthesize keystrokes, or launch an app just to quit it.
static napi_value requestQuit(napi_env env, napi_callback_info info) {
  @autoreleasepool {
    NSString *path = stringArg(env, info);
    if (!path.length) return fail(env, "Missing application path.");
    NSRunningApplication *target = nil;
    for (NSRunningApplication *candidate in NSWorkspace.sharedWorkspace.runningApplications) {
      if ([candidate.bundleURL.path.stringByStandardizingPath isEqualToString:path.stringByStandardizingPath]) {
        if (target) return fail(env, "Multiple instances of that app are running. Choose a specific instance manually.");
        target = candidate;
      }
    }
    int32_t pid = 0;
    if (target && !target.terminated) {
      if (target.processIdentifier == getpid() || target.activationPolicy != NSApplicationActivationPolicyRegular ||
          [target.bundleIdentifier isEqualToString:@"com.apple.finder"])
        return fail(env, "That application cannot be quit with this control.");
      pid = target.processIdentifier;
      if (![target terminate]) return fail(env, "The application did not accept the quit request. It may need your attention.");
    }
    napi_value result; napi_create_int32(env, pid, &result); return result;
  }
}
static napi_value appRunning(napi_env env, napi_callback_info info) {
  @autoreleasepool {
    size_t argc = 1; napi_value arg; int32_t pid = 0;
    napi_get_cb_info(env, info, &argc, &arg, NULL, NULL);
    if (!argc || napi_get_value_int32(env, arg, &pid) != napi_ok || pid <= 0) return fail(env, "Missing application identity.");
    NSRunningApplication *target = [NSRunningApplication runningApplicationWithProcessIdentifier:pid];
    napi_value result; napi_get_boolean(env, target && !target.terminated, &result); return result;
  }
}
// Read-only grounding for the screenshot workflow. Never read field values.
static id axAttribute(AXUIElementRef element, CFStringRef name) {
  CFTypeRef value = NULL;
  if (AXUIElementCopyAttributeValue(element, name, &value) != kAXErrorSuccess) return nil;
  return CFBridgingRelease(value);
}
static napi_value visibleControls(napi_env env, napi_callback_info info) {
  @autoreleasepool {
    if (!AXIsProcessTrusted()) return fail(env, "Accessibility permission is required.");
    NSRunningApplication *front = NSWorkspace.sharedWorkspace.frontmostApplication;
    AXUIElementRef application = AXUIElementCreateApplication(front.processIdentifier);
    AXUIElementSetMessagingTimeout(application, 0.05);
    id window = axAttribute(application, kAXFocusedWindowAttribute);
    CFRelease(application);
    NSMutableArray *queue = [NSMutableArray array];
    if (window) [queue addObject:window];
    NSMutableArray *items = [NSMutableArray array];
    NSSet *roles = [NSSet setWithArray:@[@"AXButton", @"AXTextField", @"AXTextArea", @"AXPopUpButton", @"AXCheckBox", @"AXRadioButton", @"AXLink", @"AXMenuItem", @"AXComboBox"]];
    CFAbsoluteTime deadline = CFAbsoluteTimeGetCurrent() + 0.4;
    for (NSUInteger i = 0; i < queue.count && i < 500 && items.count < 60 && CFAbsoluteTimeGetCurrent() < deadline; i++) {
      AXUIElementRef element = (__bridge AXUIElementRef)queue[i];
      AXUIElementSetMessagingTimeout(element, 0.03);
      NSString *role = axAttribute(element, kAXRoleAttribute);
      if ([role isKindOfClass:NSString.class] && [roles containsObject:role] && ![axAttribute(element, kAXSubroleAttribute) isEqual:@"AXSecureTextField"] &&
          ![axAttribute(element, kAXEnabledAttribute) isEqual:@NO]) {
        id position = axAttribute(element, kAXPositionAttribute), size = axAttribute(element, kAXSizeAttribute);
        CGPoint point; CGSize dimensions;
        if (position && size && CFGetTypeID((__bridge CFTypeRef)position) == AXValueGetTypeID() &&
            CFGetTypeID((__bridge CFTypeRef)size) == AXValueGetTypeID() &&
            AXValueGetValue((__bridge AXValueRef)position, kAXValueCGPointType, &point) &&
            AXValueGetValue((__bridge AXValueRef)size, kAXValueCGSizeType, &dimensions) && dimensions.width > 0 && dimensions.height > 0) {
          NSString *label = axAttribute(element, kAXTitleAttribute);
          if (![label isKindOfClass:NSString.class] || !label.length) label = axAttribute(element, kAXDescriptionAttribute);
          if (![label isKindOfClass:NSString.class]) label = @"";
          if (label.length > 120) label = [label substringToIndex:120];
          [items addObject:@{@"role":role, @"label":label, @"x":@(point.x), @"y":@(point.y), @"width":@(dimensions.width), @"height":@(dimensions.height)}];
        }
      }
      NSArray *children = axAttribute(element, kAXChildrenAttribute);
      if ([children isKindOfClass:NSArray.class]) {
        for (id child in children) { if (queue.count >= 500) break; [queue addObject:child]; }
      }
    }
    // Discard the whole observation if focus changed during traversal.
    if (NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier != front.processIdentifier) [items removeAllObjects];
    NSData *data = [NSJSONSerialization dataWithJSONObject:items options:0 error:nil];
    NSString *json = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    napi_value result; napi_create_string_utf8(env, json.UTF8String ?: "[]", NAPI_AUTO_LENGTH, &result); return result;
  }
}
static napi_value init(napi_env env, napi_value exports) {
  napi_value fn; napi_create_function(env, "control", NAPI_AUTO_LENGTH, control, NULL, &fn);
  napi_set_named_property(env, exports, "control", fn);
  napi_create_function(env, "savedMinimized", NAPI_AUTO_LENGTH, savedMinimized, NULL, &fn);
  napi_set_named_property(env, exports, "savedMinimized", fn);
  napi_create_function(env, "appPath", NAPI_AUTO_LENGTH, appPath, NULL, &fn); napi_set_named_property(env, exports, "appPath", fn);
  napi_create_function(env, "activateApp", NAPI_AUTO_LENGTH, activateApp, NULL, &fn); napi_set_named_property(env, exports, "activateApp", fn);
  napi_create_function(env, "appVisible", NAPI_AUTO_LENGTH, appVisible, NULL, &fn); napi_set_named_property(env, exports, "appVisible", fn);
  napi_create_function(env, "requestQuit", NAPI_AUTO_LENGTH, requestQuit, NULL, &fn); napi_set_named_property(env, exports, "requestQuit", fn);
  napi_create_function(env, "appRunning", NAPI_AUTO_LENGTH, appRunning, NULL, &fn); napi_set_named_property(env, exports, "appRunning", fn);
  napi_create_function(env, "visibleControls", NAPI_AUTO_LENGTH, visibleControls, NULL, &fn); napi_set_named_property(env, exports, "visibleControls", fn);
  napi_add_env_cleanup_hook(env, cleanup, NULL);
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
