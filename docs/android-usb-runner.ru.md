# GitHub Actions -> Windows PC -> Android по USB

Эта схема устанавливает APK, собранный GitHub Actions, на Android-телефон через Windows-компьютер с self-hosted runner.

```text
GitHub-hosted job -> APK artifact
                         |
                         v
Windows self-hosted runner -> ADB -> Android по USB
```

Входящие порты не нужны: runner сам подключается к GitHub по HTTPS/443.

## 1. Установить ADB

Открыть PowerShell:

```powershell
$Root = "C:\Android"
$Zip = "$env:TEMP\platform-tools-latest-windows.zip"

New-Item -ItemType Directory -Force -Path $Root | Out-Null
Invoke-WebRequest `
  -Uri "https://dl.google.com/android/repository/platform-tools-latest-windows.zip" `
  -OutFile $Zip
Expand-Archive -Path $Zip -DestinationPath $Root -Force

$Adb = "$Root\platform-tools\adb.exe"
[Environment]::SetEnvironmentVariable("ADB_PATH", $Adb, "User")

$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($UserPath -notlike "*$Root\platform-tools*") {
    [Environment]::SetEnvironmentVariable(
        "Path",
        (($UserPath.TrimEnd(';') + ";$Root\platform-tools").TrimStart(';')),
        "User"
    )
}

& $Adb version
```

Закрыть и заново открыть PowerShell.

## 2. Подготовить телефон

1. Включить режим разработчика.
2. Включить "Отладка по USB".
3. Подключить кабелем с передачей данных.
4. Подтвердить RSA-ключ компьютера.
5. Отметить "Всегда разрешать с этого компьютера".

Проверка:

```powershell
adb kill-server
adb start-server
adb devices -l
```

Нужен статус:

```text
SERIAL_NUMBER    device product:... model:...
```

`unauthorized` означает, что запрос RSA не подтверждён на телефоне.

## 3. Зарегистрировать self-hosted runner

Открыть:

https://github.com/neurofoxpro/multimental/settings/actions/runners/new

Выбрать:

```text
Operating system: Windows
Architecture: x64
```

В PowerShell выполнить команды, показанные GitHub. Рекомендуемый каталог:

```powershell
New-Item -ItemType Directory -Force C:\actions-runner\multimental | Out-Null
Set-Location C:\actions-runner\multimental
```

При выполнении `config.cmd` указать:

```text
Runner name: ИМЯ_КОМПЬЮТЕРА-multimental-usb
Additional labels: android-usb
Work folder: _work
```

Для первой проверки запустить интерактивно:

```powershell
.\run.cmd
```

Ожидаемый результат:

```text
Connected to GitHub
Listening for Jobs
```

Для постоянной работы runner можно затем установить как Windows-службу. Служба должна работать под тем же пользователем Windows, под которым телефон уже авторизован в ADB.

## 4. Добавить переменные репозитория

Открыть:

https://github.com/neurofoxpro/multimental/settings/variables/actions

Добавить:

```text
ADB_PATH = C:\Android\platform-tools\adb.exe
ADB_SERIAL = SERIAL_NUMBER
```

`ADB_SERIAL` необязателен, если всегда подключён ровно один Android-девайс.

## 5. Запустить установку

Workflow:

```text
GitHub -> neurofoxpro/multimental -> Actions -> Android device smoke
```

Он может запускаться автоматически после успешной сборки `dev` или вручную через `Run workflow`.

Процесс:

```text
скачать APK artifact
-> adb install -r
-> запустить pro.neurofox.multimental
-> проверить процесс
-> сделать screenshot
-> собрать logcat и сведения об устройстве
-> загрузить отчёт в GitHub Actions
```

## 6. Что должно быть включено

- компьютер включён;
- runner показывает `Listening for Jobs` или работает службой;
- телефон подключён по USB;
- USB-отладка разрешена;
- `adb devices -l` показывает `device`.

## 7. Результаты smoke-теста

```text
device-info.txt
install.txt
launch.txt
screenshot.png
logcat-app.txt
logcat-full.txt
package-dump.txt
summary.txt
```

## Диагностика

### `unauthorized`

Отозвать разрешения USB-отладки на телефоне, переподключить кабель и подтвердить новый RSA-запрос.

### `offline`

```powershell
adb reconnect
adb devices -l
```

Также проверить USB-порт и кабель.

### `INSTALL_FAILED_UPDATE_INCOMPATIBLE`

Установленная версия подписана другим ключом. Удалить её:

```powershell
adb uninstall pro.neurofox.multimental
```

Это удалит локальные данные приложения.

### Job остаётся в `Queued`

Проверить, что runner online и имеет labels:

```text
self-hosted
Windows
X64
android-usb
```
