!include "FileFunc.nsh"
!include "LogicLib.nsh"
!include "nsDialogs.nsh"

!ifndef BUILD_UNINSTALLER
Var PrismPreflightDialog
Var PrismPreflightSummary
Var PrismPreflightDetail
Var PrismPreflightReady

!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customPageAfterChangeDir
  Page custom PrismPreflightPageCreate PrismPreflightPageLeave
!macroend

Function PrismPreflightPageCreate
  StrCpy $PrismPreflightReady "1"
  nsDialogs::Create 1018
  Pop $PrismPreflightDialog
  ${If} $PrismPreflightDialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0u 2u 300u 28u "PRISM Story Studio 将自动创建程序目录并安装内置媒体组件。"
  Pop $PrismPreflightSummary
  ${NSD_CreateLabel} 0u 38u 300u 92u ""
  Pop $PrismPreflightDetail

  ${GetRoot} "$INSTDIR" $0
  ${If} $0 == ""
    StrCpy $PrismPreflightReady "0"
    StrCpy $1 "未识别到有效磁盘。请返回并选择本机磁盘中的安装位置。"
  ${Else}
    ${DriveSpace} "$0" "/D=F /S=M" $2
    StrCpy $3 ${ESTIMATED_SIZE}
    IntOp $3 $3 / 1024
    IntOp $4 $3 + 512
    ${If} $2 < $4
      StrCpy $PrismPreflightReady "0"
      StrCpy $1 "磁盘空间不足。需要约 $3 MB，并额外保留 512 MB；当前可用 $2 MB。"
    ${Else}
      StrCpy $1 "安装目录：$INSTDIR$\r$\n可用空间：$2 MB$\r$\n预计占用：$3 MB$\r$\n$\r$\n检查结果：可以安装"
    ${EndIf}
  ${EndIf}

  SendMessage $PrismPreflightDetail ${WM_SETTEXT} 0 "STR:$1"
  GetDlgItem $5 $HWNDPARENT 1
  ${If} $PrismPreflightReady == "1"
    SendMessage $5 ${WM_SETTEXT} 0 "STR:安装"
    EnableWindow $5 1
  ${Else}
    SendMessage $5 ${WM_SETTEXT} 0 "STR:空间不足"
    EnableWindow $5 0
  ${EndIf}
  nsDialogs::Show
FunctionEnd

Function PrismPreflightPageLeave
  ${If} $PrismPreflightReady != "1"
    MessageBox MB_ICONSTOP|MB_TOPMOST "安装前检查未通过，请返回后重新选择安装位置。"
    Abort
  ${EndIf}
FunctionEnd

!macro customInstall
  IfFileExists "$INSTDIR\resources\tools\ffmpeg.exe" +3 0
    MessageBox MB_ICONSTOP|MB_TOPMOST "安装失败：媒体处理组件 ffmpeg.exe 未写入。请确认安装盘可写并重新运行安装器。"
    Abort
  IfFileExists "$INSTDIR\resources\tools\ffprobe.exe" +3 0
    MessageBox MB_ICONSTOP|MB_TOPMOST "安装失败：媒体校验组件 ffprobe.exe 未写入。请确认安装盘可写并重新运行安装器。"
    Abort
  IfFileExists "$INSTDIR\resources\tools\real-esrgan\realesrgan-ncnn-vulkan.exe" +3 0
    MessageBox MB_ICONSTOP|MB_TOPMOST "安装失败：图片超分组件未写入。请确认安装盘可写并重新运行安装器。"
    Abort

  FileOpen $0 "$INSTDIR\安装结果.txt" w
  FileWriteUTF16LE $0 "PRISM Story Studio ${VERSION}$\r$\n"
  FileWriteUTF16LE $0 "状态：安装完成$\r$\n"
  FileWriteUTF16LE $0 "安装目录：$INSTDIR$\r$\n"
  FileWriteUTF16LE $0 "内置组件：FFmpeg、FFprobe、Real-ESRGAN$\r$\n"
  FileWriteUTF16LE $0 "外部必需组件：PRISM H3（启动 Studio 后自动检测）$\r$\n"
  FileWriteUTF16LE $0 "可选组件：ACE-Step 1.5$\r$\n"
  FileClose $0
!macroend
!endif
