; ─── Voicer Desktop Host Installer ────────────────────────────────────────────
; Inno Setup Script — bundles embedded Python + host files + auto-start

#define MyAppName "Voicer"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Voicer"
#define MyAppURL "https://voicers.vercel.app"

[Setup]
AppId={{E8C3F2A1-7B4D-4E5F-9A1C-3D6F8B2E4A7C}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppSupportURL={#MyAppURL}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
OutputDir=Output
OutputBaseFilename=VoicerSetup
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
SetupIconFile=
UninstallDisplayName={#MyAppName} Desktop Host
; Dark theme colors
WizardImageFile=
WizardSmallImageFile=

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
; Embedded Python runtime
Source: "bundle\python\*"; DestDir: "{app}\python"; Flags: ignoreversion recursesubdirs createallsubdirs
; Host application files
Source: "bundle\host\*"; DestDir: "{app}\host"; Flags: ignoreversion recursesubdirs createallsubdirs
; Start scripts
Source: "bundle\start_voicer.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "bundle\start_voicer.vbs"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Start Voicer Host"; Filename: "{app}\start_voicer.bat"; WorkingDir: "{app}\host"
Name: "{group}\Uninstall Voicer"; Filename: "{uninstallexe}"

[Registry]
; Auto-start on user logon via Registry Run key (no admin needed)
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "VoicerHost"; ValueData: "wscript.exe ""{app}\start_voicer.vbs"""; Flags: uninsdeletevalue

[Run]
; Start the host immediately after install
Filename: "{app}\start_voicer.bat"; Description: "Start Voicer Host now"; Flags: nowait postinstall skipifsilent runminimized

[UninstallRun]

[UninstallDelete]
Type: filesandordirs; Name: "{app}\host\__pycache__"
Type: files; Name: "{app}\host\.env"

[Code]
var
  GeminiPage: TInputQueryWizardPage;
  PlanPage: TInputOptionWizardPage;

procedure InitializeWizard;
begin
  // ─── Plan selection page ──────────────────────────────────────────────────
  PlanPage := CreateInputOptionPage(wpWelcome,
    'Your Plan', 'How would you like to use Voicer?',
    'Select your plan. If you chose BYOK ($4/mo), you''ll need a Gemini API key from Google AI Studio. ' +
    'If you chose Pro ($9/mo), we handle everything — no key needed.',
    True, False);
  PlanPage.Add('Pro ($9/mo) — No API key needed');
  PlanPage.Add('BYOK ($4/mo) — I have my own Gemini API key');
  PlanPage.SelectedValueIndex := 0;

  // ─── Gemini API key input page ────────────────────────────────────────────
  GeminiPage := CreateInputQueryPage(PlanPage.ID,
    'Gemini API Key', 'Paste your Google AI Studio API key',
    'You can get a free key at https://aistudio.google.com/apikeys' + #13#10 +
    'This key stays on your computer and is never sent to our servers.');
  GeminiPage.Add('API Key:', False);
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
  // Skip the Gemini key page if user picked Pro plan
  if (PageID = GeminiPage.ID) and (PlanPage.SelectedValueIndex = 0) then
    Result := True;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  // Validate Gemini key is not empty for BYOK
  if (CurPageID = GeminiPage.ID) and (PlanPage.SelectedValueIndex = 1) then
  begin
    if Trim(GeminiPage.Values[0]) = '' then
    begin
      MsgBox('Please enter your Gemini API key to continue.', mbError, MB_OK);
      Result := False;
    end;
  end;
end;

function ReadKeyFromTemplate(Key: string): string;
var
  TemplatePath: string;
  TemplateLines: TStringList;
  I: Integer;
  Line: string;
begin
  Result := '';
  TemplatePath := ExpandConstant('{app}\host\.env.template');
  if FileExists(TemplatePath) then
  begin
    TemplateLines := TStringList.Create;
    try
      TemplateLines.LoadFromFile(TemplatePath);
      for I := 0 to TemplateLines.Count - 1 do
      begin
        Line := TemplateLines[I];
        if Pos(Key + '=', Line) = 1 then
        begin
          Result := Copy(Line, Length(Key) + 2, Length(Line));
          Break;
        end;
      end;
    finally
      TemplateLines.Free;
    end;
  end;
end;

procedure UpdateEnvKey(Lines: TStringList; Key, Value: string);
var
  I: Integer;
  Found: Boolean;
begin
  Found := False;
  for I := 0 to Lines.Count - 1 do
  begin
    if Pos(Key + '=', Lines[I]) = 1 then
    begin
      Lines[I] := Key + '=' + Value;
      Found := True;
      Break;
    end;
  end;
  if not Found then
    Lines.Add(Key + '=' + Value);
end;

function ReadActivationFile: string;
var
  ActivationPath: string;
  ActivationLines: TStringList;
begin
  Result := '';
  // Look for voicer-activation.txt next to the setup exe
  ActivationPath := ExtractFilePath(ExpandConstant('{srcexe}')) + 'voicer-activation.txt';
  if FileExists(ActivationPath) then
  begin
    ActivationLines := TStringList.Create;
    try
      ActivationLines.LoadFromFile(ActivationPath);
      if ActivationLines.Count > 0 then
        Result := Trim(ActivationLines[0]);
    finally
      ActivationLines.Free;
    end;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  EnvFile: string;
  Lines: TStringList;
  GeminiKey: string;
  UseHosted: string;
  ServiceRoleKey: string;
  SupabaseUrl: string;
  UserId: string;
begin
  if CurStep = ssPostInstall then
  begin
    // Read values baked into the template at build time
    ServiceRoleKey := ReadKeyFromTemplate('SUPABASE_SERVICE_ROLE_KEY');
    SupabaseUrl := ReadKeyFromTemplate('SUPABASE_URL');

    // Read USER_ID from activation file (downloaded alongside the installer)
    UserId := ReadActivationFile;

    EnvFile := ExpandConstant('{app}\host\.env');
    Lines := TStringList.Create;
    try
      if FileExists(EnvFile) then
      begin
        // ── Upgrade path: preserve user values, update infra keys only ──
        Lines.LoadFromFile(EnvFile);
        UpdateEnvKey(Lines, 'SUPABASE_URL', SupabaseUrl);
        UpdateEnvKey(Lines, 'SUPABASE_SERVICE_ROLE_KEY', ServiceRoleKey);
        // Update USER_ID only if activation file provided a value
        if UserId <> '' then
          UpdateEnvKey(Lines, 'USER_ID', UserId);
      end
      else
      begin
        // ── Fresh install: write full .env from scratch ──
        Lines.Add('# Voicer Desktop Host Configuration');
        Lines.Add('# Generated by Voicer Installer');
        Lines.Add('');
        Lines.Add('SUPABASE_URL=' + SupabaseUrl);
        Lines.Add('SUPABASE_SERVICE_ROLE_KEY=' + ServiceRoleKey);
        Lines.Add('USER_ID=' + UserId);
        Lines.Add('');

        if PlanPage.SelectedValueIndex = 0 then
        begin
          GeminiKey := '';
          UseHosted := 'true';
        end
        else
        begin
          GeminiKey := Trim(GeminiPage.Values[0]);
          UseHosted := 'false';
        end;

        Lines.Add('GEMINI_API_KEY=' + GeminiKey);
        Lines.Add('USE_HOSTED_API=' + UseHosted);
      end;

      Lines.SaveToFile(EnvFile);
    finally
      Lines.Free;
    end;
  end;
end;
