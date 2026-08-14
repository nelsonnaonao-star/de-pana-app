@echo off
setlocal
set DEVICE=AMFIDIKNNR8HDQ69
set OUT=%TEMP%\depana_live_log.txt
echo ============================================
echo  Limpiando logcat...
echo ============================================
call adb -s %DEVICE% logcat -c
echo.
echo  Reproduce YA el bug (nota solapada) y luego
echo  pulsa Ctrl+C para parar. Los logs quedan en:
echo  %OUT%
echo.
echo  Empezando captura...
call adb -s %DEVICE% logcat -v time Capacitor/Console:* *:S | findstr /C:"[VOICE]" /C:"[EV]" /C:"[WATCHDOG]" /C:"[CHAT]"
pause
endlocal