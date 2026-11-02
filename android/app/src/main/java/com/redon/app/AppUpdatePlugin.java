package com.redon.app;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.Set;

/**
 * Plugin mínimo para la actualización in-app:
 *  - canInstall(): indica si Android permite instalar APK desde esta app.
 *  - openInstallSettings(): abre la pantalla exacta de DE PANA dentro de
 *    "Instalar apps desconocidas".
 *  - installApk({ path }): lanza el instalador usando el FileProvider ya
 *    declarado en AndroidManifest (${applicationId}.fileprovider).
 */
@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {

    private static final String APK_MIME = "application/vnd.android.package-archive";

    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", hasInstallPermission());
        call.resolve(result);
    }

    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        try {
            Intent intent;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            } else {
                intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception firstError) {
            try {
                Intent fallback = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                fallback.setData(Uri.parse("package:" + getContext().getPackageName()));
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(fallback);
                call.resolve();
            } catch (Exception secondError) {
                call.reject(
                    "No se pudo abrir los ajustes de instalación: " + secondError.getMessage(),
                    "SETTINGS_UNAVAILABLE",
                    secondError
                );
            }
        }
    }

    @PluginMethod
    public void installApk(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.trim().isEmpty()) {
            call.reject("Falta la ruta del APK.", "PATH_REQUIRED");
            return;
        }

        if (!hasInstallPermission()) {
            call.reject("INSTALL_PERMISSION_REQUIRED", "INSTALL_PERMISSION_REQUIRED");
            return;
        }

        try {
            File file = new File(path.startsWith("file://") ? Uri.parse(path).getPath() : path);
            if (!file.exists()) {
                call.reject("El APK descargado no existe.", "FILE_NOT_FOUND");
                return;
            }
            if (!file.getName().toLowerCase().endsWith(".apk")) {
                call.reject("El archivo no es un APK.", "INVALID_FILE");
                return;
            }

            // Defensa extra: solo permitir APKs dentro de la caché privada de la app.
            String canonical = file.getCanonicalPath();
            String cacheRoot = getContext().getCacheDir().getCanonicalPath() + File.separator;
            if (!canonical.startsWith(cacheRoot)) {
                call.reject("Ruta de APK no permitida.", "INVALID_PATH");
                return;
            }

            Uri uri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                file
            );

            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, APK_MIME);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("No se pudo abrir el instalador: " + e.getMessage(), "INSTALL_FAILED", e);
        }
    }

    /**
     * Comprueba que el APK descargado esté firmado con la misma clave que la app
     * instalada. Evita instalar un APK sustituido aunque el hosting se vea
     * comprometido: el atacante necesitaría el keystore oficial.
     */
    @PluginMethod
    public void verifySignature(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.trim().isEmpty()) {
            call.reject("Falta la ruta del APK.", "PATH_REQUIRED");
            return;
        }

        try {
            File file = new File(path.startsWith("file://") ? Uri.parse(path).getPath() : path);
            if (!file.exists()) {
                call.reject("El APK descargado no existe.", "FILE_NOT_FOUND");
                return;
            }

            String canonical = file.getCanonicalPath();
            String cacheRoot = getContext().getCacheDir().getCanonicalPath() + File.separator;
            if (!canonical.startsWith(cacheRoot)) {
                call.reject("Ruta de APK no permitida.", "INVALID_PATH");
                return;
            }

            PackageManager pm = getContext().getPackageManager();
            Set<String> installed = installedSignatureHashes(pm);
            Set<String> archive = archiveSignatureHashes(pm, file);
            boolean matches = !installed.isEmpty() && installed.equals(archive);

            JSObject result = new JSObject();
            result.put("matches", matches);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("No se pudo verificar la firma: " + e.getMessage(), "VERIFY_FAILED", e);
        }
    }

    @SuppressWarnings("deprecation")
    private Set<String> installedSignatureHashes(PackageManager pm) throws Exception {
        String pkg = getContext().getPackageName();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            PackageInfo info = pm.getPackageInfo(pkg, PackageManager.GET_SIGNING_CERTIFICATES);
            return hashesFromSigningInfo(info.signingInfo);
        }
        PackageInfo info = pm.getPackageInfo(pkg, PackageManager.GET_SIGNATURES);
        return hashesFromSignatures(info.signatures);
    }

    @SuppressWarnings("deprecation")
    private Set<String> archiveSignatureHashes(PackageManager pm, File file) throws Exception {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            PackageInfo info = pm.getPackageArchiveInfo(file.getAbsolutePath(), PackageManager.GET_SIGNING_CERTIFICATES);
            return info == null ? new HashSet<>() : hashesFromSigningInfo(info.signingInfo);
        }
        PackageInfo info = pm.getPackageArchiveInfo(file.getAbsolutePath(), PackageManager.GET_SIGNATURES);
        return info == null ? new HashSet<>() : hashesFromSignatures(info.signatures);
    }

    private Set<String> hashesFromSigningInfo(SigningInfo signingInfo) throws Exception {
        if (signingInfo == null) return new HashSet<>();
        return hashesFromSignatures(signingInfo.getApkContentsSigners());
    }

    private Set<String> hashesFromSignatures(Signature[] signatures) throws Exception {
        Set<String> hashes = new HashSet<>();
        if (signatures == null) return hashes;
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        for (Signature signature : signatures) {
            digest.reset();
            byte[] hash = digest.digest(signature.toByteArray());
            StringBuilder hex = new StringBuilder(hash.length * 2);
            for (byte b : hash) {
                hex.append(String.format("%02x", b & 0xff));
            }
            hashes.add(hex.toString());
        }
        return hashes;
    }

    private boolean hasInstallPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
        return getContext().getPackageManager().canRequestPackageInstalls();
    }
}
