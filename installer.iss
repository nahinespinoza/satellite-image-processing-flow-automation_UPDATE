; Instalador de Windows (Inno Setup 6.1+). Compilar con: iscc installer.iss  (requiere dist\SatelliteFlow.exe)
#define AppName "Satellite Flow"
#define SnapUrl "https://download.esa.int/step/snap/13.0/installers/esa-snap_sentinel_windows-13.0.0.exe"
#define SnaphuUrl "https://step.esa.int/thirdparties/snaphu/1.4.2-2/snaphu-v1.4.2_win64.zip"

[Setup]
AppName={#AppName}
AppVersion=1.0
DefaultDirName={autopf}\SatelliteFlow
DefaultGroupName={#AppName}
PrivilegesRequired=admin
OutputDir=dist
OutputBaseFilename=SatelliteFlowSetup
Compression=lzma2
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64compatible
DisableProgramGroupPage=yes

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"

[Files]
Source: "dist\SatelliteFlow.exe"; DestDir: "{app}"; Flags: ignoreversion

[UninstallDelete]
Type: files; Name: "{app}\snap_paths.json"
Type: filesandordirs; Name: "{app}\snaphu"

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\SatelliteFlow.exe"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\SatelliteFlow.exe"

[Run]
Filename: "{app}\SatelliteFlow.exe"; Description: "Abrir {#AppName}"; Flags: postinstall nowait skipifsilent

[Code]
var
  DownloadPage: TDownloadWizardPage;
  GptPath, PconvertPath, SnaphuPath: String;
  NeedSnap, NeedSnaphu: Boolean;

function FirstExisting(const Paths: array of String): String;
var I: Integer;
begin
  Result := '';
  for I := 0 to GetArrayLength(Paths) - 1 do
    if FileExists(Paths[I]) then begin Result := Paths[I]; Exit; end;
end;

function FindSnaphuInAuxdata: String;
var
  FindRec: TFindRec;
  Base: String;
begin
  Result := '';
  Base := GetEnv('USERPROFILE') + '\.snap\auxdata\';
  if FindFirst(Base + 'snaphu-*', FindRec) then
  try
    repeat
      if FileExists(Base + FindRec.Name + '\bin\snaphu.exe') then
      begin
        Result := Base + FindRec.Name + '\bin\snaphu.exe';
        Exit;
      end;
    until not FindNext(FindRec);
  finally
    FindClose(FindRec);
  end;
end;

procedure DetectTools;
begin
  GptPath := FirstExisting([ExpandConstant('{commonpf}\esa-snap\bin\gpt.exe'),
    ExpandConstant('{commonpf}\snap\bin\gpt.exe'), ExpandConstant('{commonpf64}\esa-snap\bin\gpt.exe'),
    FileSearch('gpt.exe', GetEnv('PATH'))]);
  PconvertPath := FirstExisting([ExpandConstant('{commonpf}\esa-snap\bin\pconvert.exe'),
    ExpandConstant('{commonpf}\snap\bin\pconvert.exe'), ExpandConstant('{commonpf64}\esa-snap\bin\pconvert.exe'),
    FileSearch('pconvert.exe', GetEnv('PATH'))]);
  SnaphuPath := FirstExisting([ExpandConstant('{app}\snaphu\bin\snaphu.exe'),
    'C:\satelital\snaphu\bin\snaphu.exe', FileSearch('snaphu.exe', GetEnv('PATH'))]);
  if SnaphuPath = '' then SnaphuPath := FindSnaphuInAuxdata;
  NeedSnap := GptPath = '';
  NeedSnaphu := SnaphuPath = '';
end;

procedure InitializeWizard;
begin
  DownloadPage := CreateDownloadPage('Descargando herramientas',
    'Se descargan las herramientas que faltan en este equipo (SNAP puede pesar ~1 GB).', nil);
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if CurPageID = wpReady then
  begin
    DetectTools;
    DownloadPage.Clear;
    if NeedSnap then DownloadPage.Add('{#SnapUrl}', 'snap_installer.exe', '');
    if NeedSnaphu then DownloadPage.Add('{#SnaphuUrl}', 'snaphu.zip', '');
    if NeedSnap or NeedSnaphu then
    begin
      DownloadPage.Show;
      try
        try
          DownloadPage.Download;
        except
          if DownloadPage.AbortedByUser then Log('Descarga cancelada')
          else SuppressibleMsgBox(AddPeriod(GetExceptionMessage), mbCriticalError, MB_OK, IDOK);
          Result := False;
        end;
      finally
        DownloadPage.Hide;
      end;
    end;
  end;
end;

function JsonPath(const P: String): String;
begin
  Result := P;
  StringChangeEx(Result, '\', '\\', True);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  RC: Integer;
  Json, DataDir, Dest: String;
  Raw: AnsiString;
begin
  if CurStep <> ssPostInstall then Exit;

  if NeedSnap then
  begin
    WizardForm.StatusLabel.Caption := 'Instalando SNAP (puede tardar varios minutos)...';
    Exec(ExpandConstant('{tmp}\snap_installer.exe'), '-q -dir "' + ExpandConstant('{commonpf}\esa-snap') + '"',
      '', SW_HIDE, ewWaitUntilTerminated, RC);
    GptPath := FirstExisting([ExpandConstant('{commonpf}\esa-snap\bin\gpt.exe')]);
    PconvertPath := FirstExisting([ExpandConstant('{commonpf}\esa-snap\bin\pconvert.exe')]);
    if GptPath = '' then
      MsgBox('No se pudo instalar SNAP automáticamente. Instálalo manualmente desde https://step.esa.int', mbError, MB_OK);
  end;

  if NeedSnaphu then
  begin
    WizardForm.StatusLabel.Caption := 'Instalando SNAPHU...';
    Dest := ExpandConstant('{app}\snaphu');
    Exec('powershell.exe', '-NoProfile -Command "Expand-Archive -Force ''' + ExpandConstant('{tmp}\snaphu.zip') +
      ''' ''' + Dest + '''"', '', SW_HIDE, ewWaitUntilTerminated, RC);
    { el zip puede traer una carpeta intermedia: buscar snaphu.exe }
    Exec('powershell.exe', '-NoProfile -Command "(Get-ChildItem -Recurse ''' + Dest +
      ''' -Filter snaphu.exe | Select-Object -First 1).FullName | Set-Content -NoNewline ''' +
      ExpandConstant('{tmp}\snaphu_path.txt') + '''"', '', SW_HIDE, ewWaitUntilTerminated, RC);
    if FileExists(ExpandConstant('{tmp}\snaphu_path.txt')) then
    begin
      LoadStringFromFile(ExpandConstant('{tmp}\snaphu_path.txt'), Raw);
      SnaphuPath := Trim(String(Raw));
    end;
  end;

  { Guardar rutas para que el programa las use }
  DataDir := GetEnv('LOCALAPPDATA') + '\SatelliteFlow';
  ForceDirectories(DataDir);
  Json := '{"GPT_BIN": "' + JsonPath(GptPath) + '", "PCONVERT_BIN": "' + JsonPath(PconvertPath) +
          '", "SNAPHU_BIN": "' + JsonPath(SnaphuPath) + '"}';
  SaveStringToFile(DataDir + '\snap_paths.json', Json, False);
  SaveStringToFile(ExpandConstant('{app}\snap_paths.json'), Json, False);
end;
