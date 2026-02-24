Get-ChildItem 'D:\dev\llaneteramulti\app\inventario' -Recurse -Include '*.tsx','*.ts','*.css' | ForEach-Object {
  $content = Get-Content $_.FullName -Raw -Encoding UTF8
  $new = $content -replace '/sistema/', '/inventario/'
  $new = $new -replace "'/sistema'", "'/inventario'"
  if ($content -ne $new) {
    Set-Content $_.FullName $new -Encoding UTF8 -NoNewline
    Write-Host "Updated: $($_.Name)"
  }
}
Write-Host "Done"
