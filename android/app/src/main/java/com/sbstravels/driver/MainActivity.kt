package com.sbstravels.driver

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private val LOCATION_PERMISSION_REQUEST_CODE = 1001

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.driverWebView)
        setupWebView()
        createNotificationChannels()
        requestAppPermissions()

        // Load production/shared app URL (no dev session cookie barrier)
        val targetUrl = "https://ais-pre-5ck7cmqnb5iqboanlakexu-1063211486846.asia-southeast1.run.app"
        webView.loadUrl(targetUrl)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        val settings: WebSettings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.setGeolocationEnabled(true)
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.allowFileAccess = true

        val cookieManager = CookieManager.getInstance()
        cookieManager.setAcceptCookie(true)
        cookieManager.setAcceptThirdPartyCookies(webView, true)

        // Register Native Android Meter Bridge for Foreground GPS Service
        webView.addJavascriptInterface(AndroidMeterBridge(this), "AndroidMeterBridge")

        webView.webChromeClient = object : WebChromeClient() {
            override fun onGeolocationPermissionsShowPrompt(
                origin: String?,
                callback: GeolocationPermissions.Callback?
            ) {
                callback?.invoke(origin, true, false)
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
                if (url == null) return false

                if (url.startsWith("tel:")) {
                    val intent = Intent(Intent.ACTION_DIAL, Uri.parse(url))
                    startActivity(intent)
                    return true
                }

                if (url.startsWith("geo:") || url.contains("maps.google.com") || url.contains("google.com/maps")) {
                    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                    startActivity(intent)
                    return true
                }

                return false
            }
        }
    }

    /**
     * JavaScript Interface Bridge exposed to Web layer as window.AndroidMeterBridge
     */
    inner class AndroidMeterBridge(private val context: MainActivity) {

        @JavascriptInterface
        fun startForegroundMeter(tripNumber: String, customerName: String) {
            val hasFineLocation = ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.ACCESS_FINE_LOCATION
            ) == PackageManager.PERMISSION_GRANTED
            val hasCoarseLocation = ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.ACCESS_COARSE_LOCATION
            ) == PackageManager.PERMISSION_GRANTED

            if (!hasFineLocation && !hasCoarseLocation) {
                context.runOnUiThread {
                    context.requestAppPermissions()
                }
                return
            }

            val serviceIntent = Intent(context, MeterForegroundService::class.java).apply {
                action = MeterForegroundService.ACTION_START_METER
                putExtra(MeterForegroundService.EXTRA_TRIP_NUMBER, tripNumber)
                putExtra(MeterForegroundService.EXTRA_CUSTOMER_NAME, customerName)
            }
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(serviceIntent)
                } else {
                    context.startService(serviceIntent)
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }

        @JavascriptInterface
        fun stopForegroundMeter() {
            try {
                val serviceIntent = Intent(context, MeterForegroundService::class.java).apply {
                    action = MeterForegroundService.ACTION_STOP_METER
                }
                context.startService(serviceIntent)
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }

        @JavascriptInterface
        fun sendNotification(title: String, message: String, channelId: String) {
            val validChannelId = if (channelId.isNotBlank()) channelId else "channel_sbs_trip_dispatch"
            val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
                ?: return

            val intent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val pendingIntent = PendingIntent.getActivity(
                context,
                System.currentTimeMillis().toInt(),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            // CRITICAL FIX: Use clean flat monochrome vector icon R.drawable.ic_notification
            // DO NOT use R.mipmap.ic_launcher (AdaptiveIconDrawable) which crashes SystemUI
            val notification = NotificationCompat.Builder(context, validChannelId)
                .setContentTitle(title)
                .setContentText(message)
                .setSmallIcon(R.drawable.ic_notification)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .build()

            notificationManager.notify((System.currentTimeMillis() % 100000).toInt(), notification)
        }

        @JavascriptInterface
        fun enterPiP() {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.runOnUiThread {
                    try {
                        context.enterPictureInPictureMode()
                    } catch (e: Exception) {
                        // Gracefully handle if PiP not supported on device
                    }
                }
            }
        }
    }

    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return

            // Channel 1: Trip Dispatch & Alerts
            val dispatchChannel = NotificationChannel(
                "channel_sbs_trip_dispatch",
                "SBS Trip Dispatch",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "New trip offers and passenger verification notices"
                enableVibration(true)
            }

            // Channel 2: Dispatcher Events
            val eventChannel = NotificationChannel(
                "channel_sbs_dispatcher_events",
                "SBS Dispatcher Events",
                NotificationManager.IMPORTANCE_DEFAULT
            ).apply {
                description = "Driver operational status and trip cancellation updates"
            }

            manager.createNotificationChannel(dispatchChannel)
            manager.createNotificationChannel(eventChannel)
        }
    }

    fun requestAppPermissions() {
        val permissionsList = mutableListOf(
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION
        )

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissionsList.add(Manifest.permission.POST_NOTIFICATIONS)
        }

        val neededPermissions = permissionsList.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }

        if (neededPermissions.isNotEmpty()) {
            ActivityCompat.requestPermissions(
                this,
                neededPermissions.toTypedArray(),
                LOCATION_PERMISSION_REQUEST_CODE
            )
        }
    }

    override fun onBackPressed() {
        if (this::webView.isInitialized && webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }
}
