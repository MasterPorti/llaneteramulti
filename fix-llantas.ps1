Get-ChildItem 'D:\dev\llaneteramulti\app\llantas' -Recurse -Include '*.tsx','*.ts' | ForEach-Object {
  $lines = Get-Content $_.FullName
  $changed = $false
  $newlines = $lines | ForEach-Object {
    $line = $_ -replace "href='/inventario'", "href='/llantas'"
    $line = $line -replace 'href="/inventario"', 'href="/llantas"'
    $line = $line -replace "href: '/inventario'", "href: '/llantas'"
    $line = $line -replace "href='/inventario/nuevo'", "href='/llantas/nuevo'"
    $line = $line -replace 'href="/inventario/nuevo"', 'href="/llantas/nuevo"'
    $line = $line -replace "href=\`\`/inventario/", 'href=`/llantas/'
    $line = $line -replace '/inventario/\$\{llanta\.id\}', '/llantas/${llanta.id}'
    $line = $line -replace '/inventario/\$\{id\}', '/llantas/${id}'
    if ($line -ne $_) { $changed = $true }
    $line
  }
  if ($changed) {
    Set-Content $_.FullName $newlines
    Write-Host "Updated: $($_.FullName)"
  }
}
Write-Host "Done"
