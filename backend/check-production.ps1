param(
    [string]$ApiOrigin = "https://ai-9kpu.onrender.com"
)

$ApiOrigin = $ApiOrigin.TrimEnd('/')
$health = Invoke-RestMethod -Uri "$ApiOrigin/health" -TimeoutSec 60 -ErrorAction Stop
if ($health.status -ne 'ok') {
    throw "Health check thất bại tại $ApiOrigin/health"
}

$openApi = Invoke-RestMethod -Uri "$ApiOrigin/openapi.json" -TimeoutSec 60 -ErrorAction Stop
$generateInput = $openApi.components.schemas.GenerateInput
if ($null -eq $generateInput.properties.main_meals -or $null -eq $generateInput.properties.side_meals) {
    throw "Backend tại $ApiOrigin chưa có API số bữa mới."
}

Write-Output "Địa chỉ backend đã xác nhận: $ApiOrigin"
Write-Output "Health: $($health.status); catalog: $($health.catalog_loaded) món"
Write-Output "GenerateInput có main_meals và side_meals."
