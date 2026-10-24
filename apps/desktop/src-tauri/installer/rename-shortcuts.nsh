; Migrate only a link targeting this installation. Preserve foreign destinations.
; Renaming also works in NSIS update mode, which skips shortcut creation.
!macro VEXTRIO_RENAME_SHORTCUT ROOT
  !insertmacro IsShortcutTarget "${ROOT}\FORMA.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
  Pop $0
  ${If} $0 = 1
    ${If} ${FileExists} "${ROOT}\VEXTRIO 3D.lnk"
      !insertmacro IsShortcutTarget "${ROOT}\VEXTRIO 3D.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
      Pop $0
      ${If} $0 = 1
        !insertmacro UnpinShortcut "${ROOT}\FORMA.lnk"
        Delete "${ROOT}\FORMA.lnk"
      ${EndIf}
    ${Else}
      !insertmacro UnpinShortcut "${ROOT}\FORMA.lnk"
      Rename "${ROOT}\FORMA.lnk" "${ROOT}\VEXTRIO 3D.lnk"
      !insertmacro SetLnkAppUserModelId "${ROOT}\VEXTRIO 3D.lnk"
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  Push $0
  !insertmacro VEXTRIO_RENAME_SHORTCUT "$SMPROGRAMS"
  !insertmacro VEXTRIO_RENAME_SHORTCUT "$DESKTOP"
  Pop $0
!macroend
