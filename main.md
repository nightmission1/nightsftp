# NightSFTP

## 1. Proje Amacı

**NightSFTP**, yetkili olunan Minecraft sunucularının `server.jar` dizinindeki dosyaları uzaktan yönetmek için geliştirilmiş bir sistemdir.

Amaç:

* Minecraft sunucusuna yalnızca `NightSFTP.jar` adlı Paper plugin'i kurmak.
* Minecraft sunucusunun dışarıya FTP/SFTP portu açmasına gerek bırakmamak.
* Plugin'in Node.js tabanlı **NightSFTP Gateway** sunucusuna outbound bağlantı kurmasını sağlamak.
* Kullanıcının **WinSCP** üzerinden standart **SFTP** ile Gateway'e bağlanmasını sağlamak.
* WinSCP üzerindeki dosya işlemlerini Minecraft sunucusundaki plugin'e aktarmak.
* Dosya erişimini yalnızca Minecraft sunucusunun `server.jar` bulunduğu dizin ve alt dizinleriyle sınırlamak.

> Sistem yalnızca sahibi olunan veya yönetim yetkisi bulunan Minecraft sunucularında kullanılmalıdır.

---

# 2. Genel Mimari

```text
                         INTERNET
                            │
                            │ SFTP
                            ▼
                    ┌─────────────────┐
                    │     WinSCP      │
                    └────────┬────────┘
                             │
                             │ Configurable SFTP Port
                             ▼
              ┌─────────────────────────────┐
              │    NightSFTP Gateway        │
              │       Node.js + TS          │
              │                             │
              │  ┌───────────────────────┐  │
              │  │ SFTP Server           │  │
              │  │ Agent Registry        │  │
              │  │ Authentication        │  │
              │  │ Session Router        │  │
              │  └───────────┬───────────┘  │
              └───────────────┼─────────────┘
                              │
                              │ TLS outbound tunnel
                              │
                              ▼
                    ┌──────────────────┐
                    │ Minecraft Server │
                    │                  │
                    │ NightSFTP.jar    │
                    │                  │
                    │ Safe File API    │
                    └────────┬─────────┘
                             │
                             ▼
                    Minecraft ROOT
                    (server.jar dizini)
```

Minecraft sunucusunun Gateway'e bağlantısı **outbound** olacaktır.

Minecraft sunucusunda WinSCP için ayrıca public FTP/SFTP portu açılmayacaktır.

---

# 3. Proje İsimleri

* Proje adı: `NightSFTP`
* Plugin JAR: `NightSFTP.jar`
* Java ana sınıfı: `com.nightmission.nightsftp.NightSFTP`
* Gateway: `NightSFTP Gateway`
* Minecraft bağlantı istemcisi: `NightSFTP Agent`
* Permission: `nightsftp.admin`
* Komut: `/nightsftp`

---

# 4. Teknolojiler

## Minecraft Plugin

* Java 21
* Paper API
* Gradle
* NIO / `java.nio.file`
* TLS WebSocket veya TLS TCP
* Async işlemler için `CompletableFuture`, ExecutorService veya NIO

## Gateway

* Node.js
* TypeScript
* SFTP/SSH server implementation
* TLS
* WebSocket veya TLS TCP
* Agent registry
* Authentication
* Session routing

## Client

* WinSCP
* SFTP

---

# 5. Minecraft Plugin

Plugin yalnızca Minecraft sunucusuna kurulacaktır.

Kurulum:

```text
plugins/
└── NightSFTP.jar
```

Plugin çalıştığında Minecraft sunucusunun `server.jar` bulunduğu dizini ROOT olarak kabul eder.

Örneğin:

```text
/home/minecraft/server/
├── server.jar
├── plugins/
├── world/
├── world_nether/
├── logs/
├── config/
└── eula.txt
```

ROOT:

```text
/home/minecraft/server/
```

Plugin bunun dışına çıkamaz.

---

# 6. Dosya Sistemi Güvenliği

NightSFTP kesinlikle işletim sistemi root dizinine erişememelidir.

İzin verilen alan:

```text
Minecraft ROOT
└── tüm alt dizinler
```

İzin verilmeyen:

```text
/
 /etc
 /home/other-user
 /var
 /root
 /usr
```

## Path traversal koruması

Aşağıdaki gibi yollar engellenmelidir:

```text
../
../../
../../../etc
plugins/../../etc
```

Absolute path'ler de engellenmelidir:

```text
/etc/passwd
/root/test
C:\Windows\
```

## Symlink Escape

Symlink kullanılarak Minecraft ROOT dışına çıkılması engellenmelidir.

Kontrol sırası:

```text
1. Kullanıcı path'i al
2. Normalize et
3. ROOT ile resolve et
4. Gerekirse realpath çözümlemesi yap
5. Sonucun ROOT altında olduğunu doğrula
6. İşleme izin ver
```

Örnek:

```text
ROOT = /minecraft/server

plugins/test.txt
        ↓
/minecraft/server/plugins/test.txt
        ↓
ROOT altında → OK
```

Ancak:

```text
plugins/link-to-etc/passwd
        ↓
/etc/passwd
        ↓
ROOT dışında → DENY
```

---

# 7. Desteklenen Dosya İşlemleri

Plugin aşağıdaki işlemleri desteklemelidir:

```text
LIST
STAT
READ
WRITE
MKDIR
RMDIR
DELETE
RENAME
```

Bunlar WinSCP işlemlerine dönüştürülecektir.

Örneğin:

```text
WinSCP:
  LIST /plugins

        ↓

Gateway:
  LIST /plugins

        ↓

Plugin:
  SafePathResolver
  FileService

        ↓

Minecraft:
  /server/plugins/
```

---

# 8. Büyük Dosyalar

Büyük dosyalar tamamen RAM'e yüklenmemelidir.

Örneğin:

```text
server.log = 2 GB
```

şeklinde bir dosya indirilirken:

```text
2 GB → RAM
```

yapılmamalıdır.

Bunun yerine:

```text
File
 ↓
Stream
 ↓
Chunk
 ↓
Gateway
 ↓
WinSCP
```

kullanılmalıdır.

Önerilen yapı:

```text
FILE_BEGIN
FILE_CHUNK
FILE_CHUNK
FILE_CHUNK
...
FILE_END
```

Chunk boyutu konfigüre edilebilir olmalıdır.

---

# 9. Gateway

NightSFTP Gateway Node.js + TypeScript ile geliştirilecektir.

Görevleri:

* WinSCP SFTP bağlantılarını kabul etmek
* Kullanıcı authentication işlemini yapmak
* Agent bağlantılarını yönetmek
* Minecraft sunucularını registry içerisinde tutmak
* SFTP işlemlerini doğru Minecraft agent'ına yönlendirmek
* Dosya transferlerini stream etmek
* Timeout ve rate limit uygulamak
* TLS kullanmak

---

# 10. Gateway Port Yapısı

Gateway portları **hardcode edilmemelidir**.

Özellikle WinSCP'nin bağlandığı SFTP portu Gateway config dosyasından değiştirilebilir olmalıdır.

Örnek:

```yaml
sftp:
  host: "0.0.0.0"
  port: 25522
```

Bu durumda WinSCP:

```text
Host: gateway.example.com
Port: 25522
Protocol: SFTP
```

ile bağlanır.

Port daha sonra:

```yaml
sftp:
  host: "0.0.0.0"
  port: 2222
```

olarak değiştirilebilir.

Kod içerisinde:

```text
22
25522
2222
```

gibi sabit bir SFTP portu kullanılmamalıdır.

Gateway startup sırasında config okunmalı ve SFTP server belirtilen host/port üzerinde başlatılmalıdır.

---

# 11. Agent Gateway Portu

Minecraft plugin'in Gateway'e outbound bağlantı kurduğu port da plugin config üzerinden belirlenebilir olmalıdır.

Örnek Gateway config:

```yaml
sftp:
  host: "0.0.0.0"
  port: 25522

agent:
  host: "0.0.0.0"
  port: 8443
  tls: true
```

Burada:

```text
25522 = WinSCP → Gateway SFTP
8443  = Minecraft Plugin → Gateway Agent Tunnel
```

Bu iki port birbirinden bağımsızdır.

Sonuç:

```text
WinSCP
   │
   │ SFTP :25522
   ▼
Gateway
   │
   │ TLS Agent Tunnel :8443
   ▼
Minecraft Plugin
```

Minecraft sunucusunun `25522` veya başka bir inbound SFTP portu açması gerekmez.

---

# 12. Gateway Config

Örnek:

```yaml
sftp:
  host: "0.0.0.0"
  port: 25522

agent:
  host: "0.0.0.0"
  port: 8443
  tls: true

security:
  max-connections: 100
  rate-limit: 100

transfer:
  chunk-size: 65536
  timeout-ms: 30000

logging:
  level: "info"
```

Gateway uygulaması bu dosyayı startup sırasında okuyacaktır.

---

# 13. Plugin Config

Minecraft sunucusundaki:

```text
plugins/NightSFTP/config.yml
```

örneği:

```yaml
gateway:
  host: "gateway.example.com"
  port: 8443
  tls: true
  agent-id: "server-001"
  token: "CHANGE_ME"

connection:
  reconnect: true
  reconnect-delay-ms: 5000
```

Plugin burada Gateway'in **agent portuna outbound** bağlantı kurar.

---

# 14. Bağlantı Sistemi

Plugin bağlantı durumları:

```text
CONNECTING
CONNECTED
AUTHENTICATING
READY
DISCONNECTED
RECONNECTING
```

Bağlantı koparsa:

```text
DISCONNECTED
      ↓
RECONNECTING
      ↓
CONNECTING
      ↓
AUTHENTICATING
      ↓
READY
```

Plugin otomatik olarak tekrar bağlanmalıdır.

Örnek:

```yaml
connection:
  reconnect: true
  reconnect-delay-ms: 5000
```

---

# 15. Agent Authentication

Her Minecraft sunucusunun benzersiz bir `agent-id` değeri olmalıdır.

Örnek:

```yaml
gateway:
  agent-id: "server-001"
  token: "CHANGE_ME"
```

Gateway tarafında:

```text
server-001 → Minecraft Server A
server-002 → Minecraft Server B
server-003 → Minecraft Server C
```

şeklinde registry tutulabilir.

Token:

* Loglara yazılmamalı
* Git repository'ye eklenmemeli
* Config örneğinde gerçek token kullanılmamalı
* Gateway tarafından doğrulanmalı

---

# 16. Plugin → Gateway Protocol

Kontrol mesajları JSON olabilir.

Örnek request:

```json
{
  "type": "request",
  "requestId": "abc123",
  "operation": "list",
  "path": "plugins"
}
```

Response:

```json
{
  "type": "response",
  "requestId": "abc123",
  "success": true
}
```

Dosya transferleri için binary frame/stream kullanılmalıdır.

Örnek:

```text
FILE_BEGIN
FILE_CHUNK
FILE_CHUNK
FILE_CHUNK
FILE_END
```

JSON yalnızca kontrol/metaveri için kullanılmalı, büyük dosyaların tamamı JSON içerisine gömülmemelidir.

---

# 17. Gateway SFTP Sistemi

WinSCP standart SFTP ile bağlanmalıdır.

Örnek:

```text
File protocol: SFTP
Host name: gateway.example.com
Port number: 25522
User name: server-001
Password: ********
```

Gateway gelen SFTP işlemlerini agent'a çevirmelidir.

Örneğin:

```text
SFTP open
SFTP read
SFTP write
SFTP close
SFTP readdir
SFTP stat
SFTP mkdir
SFTP rmdir
SFTP unlink
SFTP rename
```

bunlar NightSFTP Agent protocol mesajlarına dönüştürülür.

---

# 18. Session Routing

WinSCP kullanıcı adı veya başka bir güvenli kimlik mekanizması ile hedef agent belirlenebilir.

Örneğin:

```text
WinSCP user:
server-001
```

Gateway:

```text
server-001
     ↓
Agent Registry
     ↓
NightSFTP Agent #001
```

Ardından SFTP işlemleri ilgili Minecraft sunucusuna yönlendirilir.

---

# 19. Multi-Server

Bir Gateway birden fazla Minecraft sunucusunu destekleyebilmelidir.

```text
                 NightSFTP Gateway
                       │
          ┌────────────┼────────────┐
          │            │            │
          ▼            ▼            ▼
      Agent 001    Agent 002    Agent 003
          │            │            │
          ▼            ▼            ▼
      Server A      Server B      Server C
```

Her agent'ın:

```text
agent-id
token
connection
status
server information
```

bilgileri registry'de tutulabilir.

---

# 20. Güvenlik

Minimum güvenlik gereksinimleri:

* TLS
* Agent authentication
* SFTP authentication
* Path traversal protection
* Symlink escape protection
* ROOT sandbox
* Request timeout
* Transfer timeout
* Rate limiting
* Connection limit
* Brute-force protection
* Hassas bilgilerin loglanmaması
* Tokenların kaynak koduna gömülmemesi

Gateway internet üzerinde çalışacaksa TLS zorunlu olmalıdır.

---

# 21. Plugin Komutları

Ana komut:

```text
/nightsftp
```

Alt komutlar:

```text
/nightsftp status
/nightsftp reconnect
/nightsftp info
```

Permission:

```text
nightsftp.admin
```

Örnek:

```text
/nightsftp status
```

çıktısı:

```text
NightSFTP
Status: READY
Agent ID: server-001
Gateway: gateway.example.com:8443
TLS: enabled
```

---

# 22. Main Thread Güvenliği

Dosya işlemleri Minecraft main thread üzerinde bloklanmamalıdır.

Yanlış:

```text
onCommand()
  ↓
Files.readAllBytes()
  ↓
Minecraft main thread
```

Doğru:

```text
Request
  ↓
Async Executor
  ↓
File I/O
  ↓
Response
```

Özellikle:

* Büyük dosya okuma
* Büyük dosya yazma
* Directory listing
* Delete
* Rename
* Network I/O

async olarak yapılmalıdır.

---

# 23. Hata Kodları

Protocol aşağıdaki hata kodlarını desteklemelidir:

```text
OK
NOT_FOUND
FORBIDDEN
ALREADY_EXISTS
NOT_DIRECTORY
IS_DIRECTORY
INVALID_PATH
ROOT_ESCAPE
IO_ERROR
TIMEOUT
AGENT_OFFLINE
AUTH_FAILED
RATE_LIMITED
INTERNAL_ERROR
```

Örnek:

```json
{
  "type": "response",
  "requestId": "abc123",
  "success": false,
  "error": "ROOT_ESCAPE"
}
```

---

# 24. Proje Yapısı

```text
NightSFTP/
│
├── plugin/
│   ├── build.gradle
│   ├── settings.gradle
│   │
│   └── src/
│       └── main/
│           ├── java/
│           │   └── com/
│           │       └── nightmission/
│           │           └── nightsftp/
│           │               ├── NightSFTP.java
│           │               │
│           │               ├── command/
│           │               │   └── NightSFTPCommand.java
│           │               │
│           │               ├── config/
│           │               │   └── AgentConfig.java
│           │               │
│           │               ├── connection/
│           │               │   ├── GatewayConnection.java
│           │               │   ├── ReconnectManager.java
│           │               │   └── AuthenticationManager.java
│           │               │
│           │               ├── filesystem/
│           │               │   ├── SafePathResolver.java
│           │               │   ├── FileService.java
│           │               │   └── FileTransferService.java
│           │               │
│           │               ├── protocol/
│           │               │   ├── Message.java
│           │               │   ├── Request.java
│           │               │   ├── Response.java
│           │               │   └── ProtocolHandler.java
│           │               │
│           │               └── security/
│           │                   └── TokenManager.java
│           │
│           └── resources/
│               ├── plugin.yml
│               └── config.yml
│
└── gateway/
    ├── package.json
    ├── tsconfig.json
    ├── .env.example
    ├── config.yml
    │
    └── src/
        ├── index.ts
        │
        ├── sftp/
        │   ├── server.ts
        │   └── session.ts
        │
        ├── agents/
        │   ├── registry.ts
        │   └── connection.ts
        │
        ├── protocol/
        │   └── protocol.ts
        │
        ├── auth/
        │   └── auth.ts
        │
        └── security/
            ├── rateLimit.ts
            └── validation.ts
```

---

# 25. plugin.yml

```yaml
name: NightSFTP
version: 1.0.0
main: com.nightmission.nightsftp.NightSFTP
api-version: '1.21'

commands:
  nightsftp:
    description: NightSFTP administration command
    permission: nightsftp.admin

permissions:
  nightsftp.admin:
    default: op
```

---

# 26. Test Gereksinimleri

## Path Security

Test edilmesi gerekenler:

```text
../
../../
../../../etc
absolute paths
Windows paths
symlink escape
nested traversal
URL encoded traversal
```

Beklenen:

```text
DENIED
```

---

## File Operations

Test:

```text
LIST
STAT
READ
WRITE
MKDIR
RMDIR
DELETE
RENAME
```

---

## Connection

Test:

```text
Gateway connection
TLS
Authentication
Reconnect
Timeout
Agent offline
Invalid token
```

---

## Transfer

Test:

```text
Small file
Large file
Upload
Download
Interrupted transfer
Connection loss
Concurrent transfer
```

---

## WinSCP

Gerçek WinSCP ile test:

```text
Login
Directory listing
Upload
Download
Rename
Delete
Create directory
Remove directory
Large file transfer
Reconnect
```

---

# 27. Beklenen Kullanım

Minecraft sunucusu:

```text
plugins/NightSFTP.jar
```

ile çalışır.

Plugin Gateway'e bağlanır:

```text
Minecraft
   │
   │ outbound TLS
   ▼
Gateway:8443
```

Kullanıcı WinSCP'yi açar:

```text
WinSCP
   │
   │ SFTP
   ▼
Gateway:25522
```

Gateway iki bağlantıyı eşleştirir:

```text
WinSCP
   │
   │ SFTP :25522
   ▼
NightSFTP Gateway
   │
   │ Agent TLS :8443
   ▼
NightSFTP.jar
   │
   ▼
Minecraft ROOT
```

Kullanıcı WinSCP'de Minecraft sunucusunun dosya sistemini normal bir SFTP sunucusu gibi görür.

---

# 28. Temel Tasarım Kuralı

NightSFTP'nin en önemli kuralı:

```text
Minecraft server directory = ROOT
```

ve:

```text
ROOT dışına erişim = DAIMA RED
```

Gateway tarafında gelen path'ler güvenilmemeli, plugin tarafında tekrar doğrulanmalıdır.

Böylece Gateway'deki bir hata bile Minecraft sunucusunun işletim sistemi dosyalarına doğrudan erişim sağlamamalıdır.

---

# 29. Son Mimari

```text
┌─────────────────────────────────────────────────────────┐
│                         USER                            │
│                                                         │
│                       WinSCP                            │
└──────────────────────────┬──────────────────────────────┘
                           │
                           │ SFTP
                           │ configurable port
                           ▼
┌─────────────────────────────────────────────────────────┐
│                  NightSFTP Gateway                      │
│                                                         │
│                  Node.js + TypeScript                   │
│                                                         │
│   ┌────────────┐  ┌────────────┐  ┌────────────────┐  │
│   │ SFTP       │  │ Auth       │  │ Agent Registry │  │
│   │ Server     │  │            │  │                │  │
│   └─────┬──────┘  └────────────┘  └───────┬────────┘  │
│         │                                  │           │
└─────────┼──────────────────────────────────┼───────────┘
          │                                  │
          │                                  │ TLS
          │                                  │ outbound
          │                                  ▼
          │                         ┌──────────────────┐
          │                         │ Minecraft Server │
          │                         │                  │
          │                         │ NightSFTP.jar    │
          │                         │                  │
          │                         │ SafePathResolver │
          │                         └────────┬─────────┘
          │                                  │
          │                                  ▼
          │                         ┌──────────────────┐
          │                         │ Minecraft ROOT   │
          │                         │                  │
          │                         │ server.jar       │
          │                         │ plugins/         │
          │                         │ world/           │
          │                         │ logs/            │
          │                         └──────────────────┘
          │
          └── SFTP listener port:
              config.yml üzerinden değiştirilebilir
```

## Sonuç

NightSFTP şu modeli hedefler:

**WinSCP → Node.js Gateway → TLS outbound tunnel → NightSFTP.jar → Minecraft server directory**

Minecraft sunucusunda public FTP/SFTP portu bulunmaz.

Gateway'in WinSCP'ye açtığı SFTP portu **config üzerinden değiştirilebilir** ve plugin'in Gateway'e bağlandığı outbound port da ayrıca config üzerinden belirlenebilir.
