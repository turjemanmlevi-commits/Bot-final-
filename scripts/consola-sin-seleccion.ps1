# Desactiva la "Edicion rapida" de la consola del servidor. Con ella activada,
# un clic dentro de la ventana negra PAUSA el servidor (tareas, T0, Telegram)
# hasta que se pulsa una tecla. Lo llama INICIAR.bat; si falla no pasa nada.
$sig = @'
[DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr GetStdHandle(int nStdHandle);
[DllImport("kernel32.dll", SetLastError = true)] public static extern bool GetConsoleMode(IntPtr hConsoleHandle, out uint lpMode);
[DllImport("kernel32.dll", SetLastError = true)] public static extern bool SetConsoleMode(IntPtr hConsoleHandle, uint dwMode);
'@
try {
  $k = Add-Type -MemberDefinition $sig -Name 'ConsoleMode' -Namespace 'TicketOrchestrator' -PassThru
  $h = $k::GetStdHandle(-10)
  $mode = [uint32]0
  if ($k::GetConsoleMode($h, [ref]$mode)) {
    $new = [uint32]$mode
    if (($new -band 0x40) -ne 0) { $new = $new - 0x40 }
    $new = $new -bor 0x80
    [void]$k::SetConsoleMode($h, [uint32]$new)
  }
} catch { }
