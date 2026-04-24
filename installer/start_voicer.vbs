Set WshShell = CreateObject("WScript.Shell")
Dim bat : bat = Chr(34) & CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName) & "\start_voicer.bat" & Chr(34) & " min"
WScript.Quit WshShell.Run(bat, 0, True)
