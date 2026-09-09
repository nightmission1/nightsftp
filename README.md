# 🚀 NightSFTP - Güvenli Minecraft Uzaktan SFTP Dosya Yönetimi

**NightSFTP**, yetkili olduğunuz Minecraft sunucularının dosya sistemini (`server.jar` dizini), Minecraft sunucusunda dışarıya herhangi bir FTP/SFTP portu açmadan **WinSCP** üzerinden standart **SFTP** protokolü ile yönetmenizi sağlayan yüksek güvenlikli bir proxy ve eklenti sistemidir.

---

## 🏗️ 1. Mimari ve Çalışma Prensibi

Normal SFTP sistemlerinin aksine Minecraft sunucusunda dışarıya port açılmaz.

```text
 ┌─────────────────┐
 │     WinSCP      │ (SFTP İstemcisi)
 └────────┬────────┘
          │ SFTP Protokolü (Örn: Port 25628)
          ▼
 ┌─────────────────────────────┐
 │    NightSFTP Gateway        │ (Node.js + TypeScript Proxy Server)
 │                             │
 │  ┌───────────────────────┐  │
 │  │ SFTP Sunucusu (SSH2)  │  │
 │  │ Agent Registry        │  │
 │  │ Single-Port Demuxer   │  │
 │  └───────────┬───────────┘  │
 └──────────────┼──────────────┘
                │ Outbound TLS/WebSocket Tüneli (Örn: Port 25628)
                ▼
 ┌─────────────────────────────┐
 │    Minecraft Server         │
 │  ┌───────────────────────┐  │
 │  │ NightSFTP.jar Plugin  │  │
 │  │ SafePathResolver      │  │
 │  │ Async I/O Engine      │  │
 │  └───────────┬───────────┘  │
 └──────────────┼──────────────┘
                ▼
 ┌─────────────────────────────┐
 │    Minecraft ROOT Dizin     │ (server.jar klasörü ve alt dizinleri)
 └─────────────────────────────┘
```

1. **Minecraft Sunucusu (Plugin):** Gateway sunucusuna dışa doğru (**outbound**) WebSocket tüneli açar ve gizli `token` ile kimliğini doğrular.
2. **WinSCP (Kullanıcı):** Gateway sunucusunun açtığı SFTP portuna standart kullanıcı adı ve şifresiyle bağlanır.
3. **Gateway (Proxy):** WinSCP'den gelen dosya komutlarını (okuma, yazma, silme, dizin listeleme) canlı olarak ilgili Minecraft sunucusuna iletir.

---

## ✨ 2. Temel Özellikler

* 🛡️ **Sıfır Inbound Port (Zero Port Requirement):** Minecraft hostinginizde dışarıya port açmanıza gerek yoktur. İnternete erişimi olan her sunucuda (Aternos, Batihost, Rabisu, Keybuuk, Pterodactyl vb.) sorunsuz çalışır.
* 🔒 **Kök Dizin Sandboxing (ROOT Isolation):** Dosya erişimi kesinlikle Minecraft sunucusunun `server.jar` klasörü ve alt dizinleri ile sınırlıdır.
* 🛑 **Path Traversal & Symlink Koruması:** `../`, `/etc/passwd`, `C:\Windows` gibi üst dizin kaçışları ve Symlink (sembolik link) yönlendirme saldırıları protokol seviyesinde engellenir.
* ⚡ **Single-Port TCP Demuxing:** Gateway tek bir TCP portu (`25628`) üzerinden hem WinSCP SSH bağlantılarını hem de Minecraft WebSocket tünellerini aynı anda çalıştırabilir.
* 🚀 **Main Thread Güvenliği (Async I/O):** Dosya okuma/yazma ve listeleme işlemleri Minecraft ana sunucu izleğini (Main Thread) bloklamaz, oyunda lag/taktırma yapmaz.
* 💾 **RAM Dostu Parçalı Transfer (Streamed Chunked I/O):** 2 GB büyüklüğündeki `server.log` gibi dosyalar RAM'e yüklenmeden 64 KB'lık parçalar halinde akışlı olarak iletilir.

---

## 🛠️ 3. Kurulum Rehberi

### 🔵 A. Gateway Sunucu Kurulumu (Node.js VPS veya Hosting)

1. `output/gateway` klasörünü sunucunuza yükleyin.
2. `config.yml` dosyasını düzenleyin:
   ```yaml
   sftp:
     host: "0.0.0.0"
     port: 25628

   agent:
     host: "0.0.0.0"
     port: 25628   # Tek port modunda ikisi aynı olabilir
     tls: false

   agents:
     server-001:
       token: "GIZLI_AGENT_TOKENINIZ"
       sftp-username: "kullanici_adiniz"
       sftp-password: "sftp_sifreniz"
   ```
3. Uygulamayı başlatın:
   ```bash
   cd gateway
   node dist/index.js
   ```

---

### 🟢 B. Minecraft Eklenti Kurulumu (Paper / Spigot / Leaf 1.21+)

1. `output/NightSFTP.jar` dosyasını Minecraft sunucunuzun **`plugins/`** klasörüne atın.
2. Sunucuyu başlatın.
3. `plugins/NightSFTP/config.yml` dosyasını düzenleyin:
   ```yaml
   gateway:
     host: "gateway-ip-niz-veya-domain.com"
     port: 25628
     tls: false
     agent-id: "server-001"                  # Gateway'deki agent-id ile aynı
     token: "GIZLI_AGENT_TOKENINIZ"          # Gateway'deki token ile aynı
   ```
4. Sunucuya `/reload` atın veya yeniden başlatın.

---

## 📡 4. WinSCP İle Bağlantı Kurma

* **Dosya Protokolü:** `SFTP`
* **Sunucu Adı (Host):** Gateway IP adresi veya Alan Adı
* **Port:** `25628`
* **Kullanıcı Adı:** `gateway/config.yml` içindeki `sftp-username`
* **Parola:** `gateway/config.yml` içindeki `sftp-password`

---

## 💬 5. Plugin Komutları ve İzinler

| Komut | İzin | Açıklama |
| :--- | :--- | :--- |
| `/nightsftp status` | `nightsftp.admin` | Agent tünelinin bağlantı ve doğrulama durumunu gösterir (`READY`, `RECONNECTING` vb.). |
| `/nightsftp reconnect` | `nightsftp.admin` | Gateway tünel bağlantısını kesip yeniden başlatır. |
| `/nightsftp info` | `nightsftp.admin` | Eklenti versiyonunu ve transfer ayarlarını listeler. |

---

## 🔐 6. Güvenlik Notları

* **Tüm SFTP Transferleri Şifrelidir:** WinSCP ile Gateway arasındaki iletişim SSH2 (AES-256) ile uçtan uca şifrelenir.
* **Token Güvenliği:** `token` değerlerini kaynak kodlarına eklemeyin ve 3. şahıslarla paylaşmayın.
