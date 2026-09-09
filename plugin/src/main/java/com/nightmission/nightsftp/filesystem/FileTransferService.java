package com.nightmission.nightsftp.filesystem;

import com.nightmission.nightsftp.protocol.Response;

import java.io.RandomAccessFile;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class FileTransferService {

    private final SafePathResolver resolver;
    private final ExecutorService transferExecutor;

    public FileTransferService(SafePathResolver resolver) {
        this.resolver = resolver;
        this.transferExecutor = Executors.newFixedThreadPool(4, r -> {
            Thread t = new Thread(r, "NightSFTP-Transfer-Worker");
            t.setDaemon(true);
            return t;
        });
    }

    public void shutdown() {
        transferExecutor.shutdown();
    }

    /**
     * Reads a chunk of bytes from offset up to length without loading full file in RAM.
     */
    public CompletableFuture<Response> readChunk(String requestId, String path, long offset, int length) {
        return CompletableFuture.supplyAsync(() -> {
            SafePathResolver.PathResult result = resolver.resolvePath(path);
            if (!result.isOk()) {
                return Response.fail(requestId, result.getStatus().name());
            }

            Path target = result.getTargetPath();
            if (!Files.exists(target)) {
                return Response.fail(requestId, "NOT_FOUND");
            }
            if (Files.isDirectory(target)) {
                return Response.fail(requestId, "IS_DIRECTORY");
            }

            try (FileChannel channel = FileChannel.open(target, StandardOpenOption.READ)) {
                long fileSize = channel.size();
                if (offset >= fileSize) {
                    Map<String, Object> data = new HashMap<>();
                    data.put("bytesRead", 0);
                    data.put("eof", true);
                    data.put("chunk", "");
                    return Response.ok(requestId, data);
                }

                int bytesToRead = (int) Math.min(length, fileSize - offset);
                ByteBuffer buffer = ByteBuffer.allocate(bytesToRead);
                channel.position(offset);
                int read = channel.read(buffer);

                buffer.flip();
                byte[] bytes = new byte[buffer.remaining()];
                buffer.get(bytes);

                String base64Data = Base64.getEncoder().encodeToString(bytes);
                Map<String, Object> data = new HashMap<>();
                data.put("bytesRead", read);
                data.put("eof", (offset + read) >= fileSize);
                data.put("chunk", base64Data);

                return Response.ok(requestId, data);
            } catch (Exception e) {
                return Response.fail(requestId, "IO_ERROR");
            }
        }, transferExecutor);
    }

    /**
     * Writes a chunk of Base64 encoded bytes to target path at specified offset.
     */
    public CompletableFuture<Response> writeChunk(String requestId, String path, long offset, String base64Data) {
        return CompletableFuture.supplyAsync(() -> {
            SafePathResolver.PathResult result = resolver.resolvePath(path);
            if (!result.isOk()) {
                return Response.fail(requestId, result.getStatus().name());
            }

            Path target = result.getTargetPath();
            if (Files.isDirectory(target)) {
                return Response.fail(requestId, "IS_DIRECTORY");
            }

            try {
                // Ensure parent directories exist
                Path parent = target.getParent();
                if (parent != null && !Files.exists(parent)) {
                    Files.createDirectories(parent);
                }

                byte[] bytes = Base64.getDecoder().decode(base64Data != null ? base64Data : "");
                
                try (RandomAccessFile raf = new RandomAccessFile(target.toFile(), "rw");
                     FileChannel channel = raf.getChannel()) {
                    if (offset == 0) {
                        channel.truncate(0);
                    }
                    channel.position(offset);
                    ByteBuffer buffer = ByteBuffer.wrap(bytes);
                    int written = channel.write(buffer);

                    Map<String, Object> data = new HashMap<>();
                    data.put("bytesWritten", written);
                    return Response.ok(requestId, data);
                }

            } catch (Exception e) {
                return Response.fail(requestId, "IO_ERROR");
            }
        }, transferExecutor);
    }
}
