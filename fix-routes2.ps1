Get-ChildItem 'D:\dev\llaneteramulti\app\inventario' -Recurse -Include '*.tsx','*.ts','*.css' | ForEach-Object {
  $lines = Get-Content $_.FullName
  $changed = $false
  $newlines = $lines | ForEach-Object {
    $line = $_ -replace '/sistema/', '/inventario/'
    $line = $line -replace "'/sistema'", "'/inventario'"
    if ($line -ne $_) { $changed = $true }
    $line
  }
  if ($changed) {
    Set-Content $_.FullName $newlines
    Write-Host "Updated: $($_.Name)"
  }
}
Write-Host "Done"
