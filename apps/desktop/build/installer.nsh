!include "getProcessInfo.nsh"
Var pid

!macro customCheckAppRunning
  !insertmacro IS_POWERSHELL_AVAILABLE

  !ifndef BUILD_UNINSTALLER
    !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0

    ${If} $R0 == 0
      DetailPrint "Requesting ${PRODUCT_NAME} to exit before upgrade..."
      ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --quit-for-update' $R2

      StrCpy $R1 0
      ${Do}
        !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
        ${If} $R0 != 0
          ${ExitDo}
        ${EndIf}
        IntOp $R1 $R1 + 1
        ${If} $R1 >= 60
          ${ExitDo}
        ${EndIf}
        Sleep 250
      ${Loop}
    ${EndIf}
  !endif

  # Retain electron-builder's scoped process detection, force-stop fallback,
  # and elevated-process prompt instead of killing same-named apps elsewhere.
  !insertmacro _CHECK_APP_RUNNING
!macroend
