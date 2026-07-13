# Capacitor core
-keep class com.getcapacitor.** { *; }
-keep class com.capacitorjs.** { *; }
-keepattributes *Annotation*

# Capacitor plugins
-keep class com.capacitorjs.plugins.** { *; }
-keep class com.getcapacitor.community.** { *; }

# Firebase Cloud Messaging
-keep class com.google.firebase.messaging.** { *; }
-keep class com.google.firebase.iid.** { *; }

# Firebase messaging service (our CallFcmService)
-keep class com.redon.app.CallFcmService { *; }
-keep class com.redon.app.CallActionReceiver { *; }

# WebView JS interface
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Preserve line numbers for crash reports
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
