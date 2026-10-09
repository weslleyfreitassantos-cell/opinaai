# Opina AI

Painel administrativo e aplicativo Android de pesquisa de satisfação em tablets.

## Fluxo do produto

- O administrador cria uma pesquisa e escolhe emoji, estrelas, escala ou opções.
- O tablet é pareado por código e recebe a pesquisa ativa por polling seguro.
- Respostas são enviadas com `submissionId` idempotente; quando a conexão cai, ficam em fila local e são sincronizadas depois.
- Relatórios filtram empresa, pesquisa, unidade, tablet e período.

## Desenvolvimento local

Requisitos: Node.js 22, Docker Desktop e Android Studio apenas para o APK.

```powershell
npm ci
docker compose up -d postgres
npm run check
npm run test:integration
npm run build
```

O PostgreSQL local usa `localhost:5433`. Para derrubar somente o banco:

```powershell
docker compose stop postgres
```

## Tablet navegador

O modo navegador nunca envia respostas. Use:

- `http://localhost:5173/tablet?type=stars`
- `http://localhost:5173/tablet?type=emoji`

O APK Android usa a URL de `VITE_OPINA_API_BASE_URL` definida em `.env.production`.

## APK de desenvolvimento

```powershell
$env:JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"
$env:ANDROID_SDK_ROOT=$env:ANDROID_HOME
npm run android:build
adb install -r android\app\build\outputs\apk\debug\app-debug.apk
```

## APK de release assinado

O build de release falha de propósito se as credenciais de assinatura não estiverem definidas. Configure as variáveis de `.env.release.example` no ambiente do build, fora do Git, e execute:

```powershell
npm run android:release
```

O resultado será `android/app/build/outputs/apk/release/app-release.apk`.

Para o workflow manual do GitHub, configure os secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` e `ANDROID_KEY_PASSWORD`. Opcionalmente, defina as variables `OPINA_VERSION_CODE` e `OPINA_VERSION_NAME`.

## Modo quiosque

O aplicativo possui receiver de Device Owner e entra em Lock Task quando o tablet é provisionado. Em um aparelho de fábrica ou resetado:

```powershell
adb shell dpm set-device-owner br.com.grupotec.opinaai/.OpinaDeviceAdminReceiver
```

Esse comando só funciona antes de outra conta/gerenciamento ser configurado no aparelho. Sem Device Owner, o Android mantém as limitações normais de segurança e o Lock Task completo não é garantido.

## Produção

O container de produção executa as migrations automaticamente e precisa de `DATABASE_URL`, `JWT_SECRET` e credenciais de bootstrap apenas no ambiente do servidor. Faça backup do volume PostgreSQL antes de aplicar migrations.

Backup lógico agendável no servidor Linux:

```sh
DATABASE_URL='postgres://...' BACKUP_DIR=/var/backups/opinaai ./ops/backup-postgres.sh
```

O deploy web deve executar `npm ci`, `npm run check`, `npm run test:integration`, `npm run build` e reiniciar o container com a nova imagem.
