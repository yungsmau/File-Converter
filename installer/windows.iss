; Windows installer script (Inno Setup 6).
; The version is passed at build time: ISCC /DAppVersion=0.1.0 installer\windows.iss
; Keep this file ASCII-only: Inno reads scripts without a BOM as ANSI.
; Russian wizard texts come from Russian.isl.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
AppId={{86F2E2D0-BAB4-4B41-A513-4EE7BFDF4089}
AppName=Converter
AppVersion={#AppVersion}
DefaultDirName={autopf}\Converter
DefaultGroupName=Converter
UninstallDisplayIcon={app}\Converter.exe
SetupIconFile=..\icon.ico
OutputDir=output
OutputBaseFilename=Converter-Setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
; per-user install without admin rights (Inno asks if the user wants to choose)
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog

[Languages]
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "..\dist\Converter\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\Converter"; Filename: "{app}\Converter.exe"
Name: "{autodesktop}\Converter"; Filename: "{app}\Converter.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\Converter.exe"; Description: "{cm:LaunchProgram,Converter}"; Flags: nowait postinstall skipifsilent