!ifndef BUILD_UNINSTALLER
  !include "getProcessInfo.nsh"
  Var pid
!endif

!macro customCheckAppRunning
  !insertmacro IS_POWERSHELL_AVAILABLE

  !ifndef BUILD_UNINSTALLER
    ${GetProcessInfo} 0 $pid $R2 $R3 $R4 $R5
    !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0

    ${If} $R0 == 0
      # The desktop shell and its embedded runtime intentionally use the same
      # Electron executable. A graceful second-instance handshake is therefore
      # not a reliable installer gate (it also breaks when the installer is
      # elevated and the app is not). Close every process rooted in this
      # installation directory immediately and verify the directory is free.
      DetailPrint "Force-closing ${PRODUCT_NAME} processes before upgrade..."
      !insertmacro KILL_PROCESS "${APP_EXECUTABLE_FILENAME}" 1

      StrCpy $R1 0
      ${Do}
        !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
        ${If} $R0 != 0
      ${ExitDo}
        ${EndIf}
        IntOp $R1 $R1 + 1
        ${If} $R1 >= 40
          DetailPrint "The application process tree is still present; retrying a forced close..."
          !insertmacro KILL_PROCESS "${APP_EXECUTABLE_FILENAME}" 1
          Sleep 500
          !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
          ${If} $R0 == 0
            MessageBox MB_OK|MB_ICONSTOP "${PRODUCT_NAME} 仍有进程占用安装目录，请先在任务管理器结束它们，然后重新运行安装程序。"
            Abort
          ${EndIf}
          ${ExitDo}
        ${EndIf}
        Sleep 250
      ${Loop}
    ${EndIf}
  !endif

!macroend

!macro customUnInstallCheck
  # Older builds can report exit code 2 because their uninstaller sees its
  # own process as an application process. Once that process has exited, the
  # installer can remove only the registered old install directory and keep
  # all user data untouched.
  ${if} $R0 != 0
    ${if} $INSTDIR != ""
      DetailPrint "Legacy uninstaller returned $R0; removing old install files..."
      ClearErrors
      RMDir /r "$INSTDIR"
      ${if} ${FileExists} "$INSTDIR"
        Return
      ${endif}
      ClearErrors
    ${endif}
  ${endif}
!macroend
