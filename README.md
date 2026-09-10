# 🚀 NightSFTP - Güvenli & Dinamik Minecraft SFTP Proxy & Eklenti Sistemi

**NightSFTP**, yetkili olduğunuz Minecraft sunucularının dosya sistemini (`server.jar` dizini), Minecraft sunucusunda dışarıya herhangi bir FTP/SFTP portu açmadan **WinSCP**, **FileZilla** veya **Windows Dosya Gezgini (RaiDrive)** üzerinden standart **SFTP** protokolü ile yönetmenizi sağlayan yüksek güvenlikli, SQLite tabanlı yetkilendirme altyapısına sahip bir proxy ve eklenti sistemidir.

---

## 🏗️ 1. Mimari ve Çalışma Prensibi

Normal SFTP sistemlerinin aksine Minecraft sunucusunda dışarıya port açılmaz.

```text
 ┌─────────────────────────┐
 │ FileZilla / WinSCP / UI │ (SFTP İstemcileri)
 └────────────┬────────────┘
              │ SFTP Protokolü (Örn: Port 2222)
              ▼
 ┌────────────────────────────────────────────────────────┐
 │                   NightSFTP Gateway                    │
 │                                                        │
 │  ┌──────────────────────────────────────────────────┐  │
 │  │ SFTP Server (SSH2) & Multi-Tenant Agent Registry │  │
 │  │ SQLite Database (Users, Password Hashes, Grants) │  │
 │  │ Interactive Terminal CLI                         │  │
 │  └─────────────────────────┬────────────────────────┘  │
 └────────────────────────────┼───────────────────────────┘
                              │ Outbound WebSocket Tünelleri (Örn: Port 8080)
                              ▼
 ┌────────────────────────────────────────────────────────┐
 │                    Minecraft Server                    │
 │  ┌──────────────────────────────────────────────────┐  │
 │  │ NightSFTP.jar Plugin                             │  │
 │  │ SafePathResolver & Async I/O Engine              │  │
 │  └─────────────────────────┬────────────────────────┘  │
 └────────────────────────────┼───────────────────────────┘
                              ▼
 ┌────────────────────────────────────────────────────────┐
 │                  Minecraft ROOT Dizin                  │ (server.jar klasörü ve alt dizinleri)
 └────────────────────────────────────────────────────────┘
```

1. **Minecraft Sunucusu (Plugin):** Gateway sunucusuna dışa doğru (**outbound**) WebSocket tüneli açar ve benzersiz `agent-id` ve `token` ile kimliğini doğrular.
2. **SFTP İstemcisi (Kullanıcı):** Gateway'in açtığı SFTP portuna SQLite üzerinde tanımlı kullanıcı adı ve şifresiyle bağlanır.
3. **Gateway (Proxy & Auth Engine):** Kullanıcının hangi sunucuya (`/server-001/`, `/server-002/` vb.) ve hangi klasörlere ne düzeyde yetkisi olduğunu (`READ`, `WRITE`, `DELETE`, `EXECUTE`, `ALL`) SQLite üzerinden anlık kontrol eder ve istekleri canlı olarak ilgili Minecraft sunucusuna iletir.

---

## ✨ 2. Öne Çıkan Özellikler

* 🛡️ **Sıfır Inbound Port (Zero Port Requirement):** Minecraft sunucularınızda dışarıya port açılmasına gerek yoktur. Pterodactyl, Batihost, Rabisu vb. tüm ortamlarda çalışır.
* 👥 **Dinamik Çoklu Kullanıcı & SQLite Veritabanı:** Kullanıcılar, şifreler (scrypt hashli) ve sunucu bazlı yetkiler tamamen SQLite veritabanında saklanır. Config dosyasında kullanıcı/şifre bulunmaz!
* 🔑 **İnteraktif CLI Terminali:** Gateway çalışırken canlı konsol üzerinden `adduser`, `setpassword`, `setagenttoken`, `grant`, `revoke`, `users`, `agents` komutlarıyla anında yönetim.
* 📂 **Klasör ve İşlem Bazlı İzin Yönetimi (RBAC):** Kullanıcılara belirli sunucularda yalnızca belirli dizinler için yetki verebilirsiniz (`READ`, `WRITE`, `DELETE`, `EXECUTE`, `ALL`).
* 💻 **Windows Dosya Gezgini & RaiDrive Uyumluluğu:** `REALPATH` ve `OPEN` (CREAT/TRUNC) işleyicileri optimize edilmiştir, Windows Ağ Konumu olarak bağlanıldığında takılma/zaman aşımı yapmaz.
* 🔒 **Kök Dizin Sandboxing & Path Traversal Engeli:** `../` kaçışları, Symlink yönlendirmeleri ve sistem dizinlerine erişim protokol seviyesinde engellenir.
* ⚡ **Async I/O Engine:** Okuma/yazma ve listeleme işlemleri Minecraft ana sunucu izleğini (Main Thread) bloklamaz, oyunda lag/taktırma yapmaz.

---

## 🛠️ 3. Kurulum Rehberi

### 🔵 A. Gateway Sunucu Kurulumu (Node.js VPS veya Hosting)

1. `output/gateway` klasörünü (veya `output/gateway.zip` içeriğini) sunucunuza aktarın.
2. Gateway ilk başlatıldığında eğer `config.yml` yoksa otomatik olarak sade varsayılan ayarları oluşturur:
   ```yaml
   sftp:
     port: 2222
     host: 0.0.0.0

   tunnel:
     port: 8080
     host: 0.0.0.0
   ```
3. Uygulamayı başlatın:
   ```bash
   cd gateway
   node dist/index.js
   ```

---

### 🟢 B. Minecraft Eklenti Kurulumu (Paper / Spigot 1.16 - 1.21+)

1. `output/NightSFTP.jar` dosyasını Minecraft sunucunuzun **`plugins/`** klasörüne atın.
2. Sunucuyu başlatın.
3. `plugins/NightSFTP/config.yml` dosyasını düzenleyin:
   ```yaml
   gateway:
     host: "gateway-ip-niz-veya-domain.com"
     port: 8080
     agent-id: "server-001"                  # Sunucunuza verdiğiniz benzersiz kimlik
     token: "GIZLI_AGENT_TOKENINIZ"          # Gateway CLI üzerinden tanımladığınız token
   ```
4. Sunucuyu yeniden başlatın.

---

## 💻 4. Gateway CLI Komutları (İnteraktif Terminal)

Gateway çalışırken konsoldan aşağıdaki komutları kullanabilirsiniz:

| Komut | Açıklama |
| :--- | :--- |
| `help` | Kullanılabilir komutları listeler. |
| `adduser <username> <password>` | Yeni bir SFTP kullanıcısı ekler. |
| `setpassword <username> <new_password>` | Mevcut kullanıcının şifresini değiştirir. |
| `deluser <username>` | Kullanıcıyı siler. |
| `setagenttoken <server_id> <token>` | Agent (sunucu) için bağlantı token'ı tanımlar/değiştirir. |
| `grant <user> <server_id> <path> <RIGHTS>` | Kullanıcıya yetki verir (Örn: `grant admin server-001 / ALL`). |
| `revoke <user> <server_id> <path>` | Kullanıcının yetkisini kaldırır. |
| `users` | Kayıtlı tüm kullanıcıları ve yetkilerini gösterir. |
| `agents` | Bağlı ve kayıtlı tüm agent'ları durumlarıyla (ONLINE/OFFLINE) gösterir. |

---

## 📡 5. WinSCP / FileZilla İle Bağlantı

* **Dosya Protokolü:** `SFTP`
* **Sunucu Adı (Host):** Gateway IP adresi veya Alan Adı
* **Port:** `2222` (config.yml içindeki sftp.port)
* **Kullanıcı Adı:** CLI ile eklediğiniz kullanıcı adı
* **Parola:** CLI ile belirlediğiniz şifre

> 💡 **Not:** Ana dizine (`/`) bağlandığınızda yetkili olduğunuz sunucuları klasör olarak görürsünüz (`/server-001/`, `/server-002/`). Dosya işlemleri için sunucu klasörünün içine girmelisiniz.

---

## 💬 6. Plugin Oyun İçi Komutları

| Komut | İzin | Açıklama |
| :--- | :--- | :--- |
| `/nightsftp status` | `nightsftp.admin` | Agent tünelinin bağlantı ve doğrulama durumunu gösterir. |
| `/nightsftp reconnect` | `nightsftp.admin` | Gateway tünel bağlantısını kesip yeniden başlatır. |
| `/nightsftp info` | `nightsftp.admin` | Eklenti versiyonunu ve transfer ayarlarını listeler. |
