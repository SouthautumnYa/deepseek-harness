!include "getProcessInfo.nsh"
Var pid

!macro customCheckAppRunning
  !insertmacro IS_POWERSHELL_AVAILABLE
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
      ${If} $R1 >= 12
        ${ExitDo}
      ${EndIf}
      Sleep 500
    ${Loop}
  ${EndIf}

  !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
  ${If} $R0 == 0
    DetailPrint "Force-closing the remaining ${PRODUCT_NAME} process tree..."
    nsExec::Exec '"$CmdPath" /C taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}" /FI "USERNAME eq %USERNAME%"'
    Pop $R0
    Sleep 800
  ${EndIf}

  # Retain electron-builder's final verification and elevated-process prompt.
  !insertmacro _CHECK_APP_RUNNING
!macroend
