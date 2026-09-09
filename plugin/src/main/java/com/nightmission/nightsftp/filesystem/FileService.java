package com.nightmission.nightsftp.filesystem;

import com.nightmission.nightsftp.protocol.Response;

import java.io.File;
import java.io.IOException;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class FileService {

    private final SafePathResolver resolver;
    private final ExecutorService ioExecutor;

    public FileService(SafePathResolver resolver) {
        this.resolver = resolver;
        this.ioExecutor = Executors.newFixedThreadPool(4, r -> {
            Thread t = new Thread(r, "NightSFTP-IO-Worker");
            t.setDaemon(true);
            return t;
        });
    }

    public void shutdown() {
        ioExecutor.shutdown();
        try {
            if (!ioExecutor.awaitTermination(3, java.util.concurrent.TimeUnit.SECONDS)) {
                ioExecutor.shutdownNow();
            }
        } catch (InterruptedException e) {
            ioExecutor.shutdownNow();
            Thread.currentThread().interrupt();
        }
    }

    public CompletableFuture<Response> listDirectory(String requestId, String path) {
        return CompletableFuture.supplyAsync(() -> {
            SafePathResolver.PathResult result = resolver.resolvePath(path);
            if (!result.isOk()) {
                return Response.fail(requestId, result.getStatus().name());
            }

            Path target = result.getTargetPath();
            if (!Files.exists(target)) {
                return Response.fail(requestId, "NOT_FOUND");
            }
            if (!Files.isDirectory(target)) {
                return Response.fail(requestId, "NOT_DIRECTORY");
            }

            List<Map<String, Object>> entries = new ArrayList<>();
            try (DirectoryStream<Path> stream = Files.newDirectoryStream(target)) {
                for (Path entry : stream) {
                    try {
                        BasicFileAttributes attrs = Files.readAttributes(entry, BasicFileAttributes.class);
                        Map<String, Object> map = new HashMap<>();
                        map.put("name", entry.getFileName().toString());
                        map.put("size", attrs.size());
                        map.put("isDirectory", attrs.isDirectory());
                        map.put("lastModified", attrs.lastModifiedTime().toMillis());
                        map.put("created", attrs.creationTime().toMillis());
                        entries.add(map);
                    } catch (IOException ignored) {}
                }
                return Response.ok(requestId, entries);
            } catch (IOException e) {
                return Response.fail(requestId, "IO_ERROR");
            }
        }, ioExecutor);
    }

    public CompletableFuture<Response> statFile(String requestId, String path) {
        return CompletableFuture.supplyAsync(() -> {
            SafePathResolver.PathResult result = resolver.resolvePath(path);
            if (!result.isOk()) {
                return Response.fail(requestId, result.getStatus().name());
            }

            Path target = result.getTargetPath();
            if (!Files.exists(target)) {
                return Response.fail(requestId, "NOT_FOUND");
            }

            try {
                BasicFileAttributes attrs = Files.readAttributes(target, BasicFileAttributes.class);
                Map<String, Object> map = new HashMap<>();
                map.put("name", target.getFileName().toString());
                map.put("size", attrs.size());
                map.put("isDirectory", attrs.isDirectory());
                map.put("lastModified", attrs.lastModifiedTime().toMillis());
                map.put("created", attrs.creationTime().toMillis());
                return Response.ok(requestId, map);
            } catch (IOException e) {
                return Response.fail(requestId, "IO_ERROR");
            }
        }, ioExecutor);
    }

    public CompletableFuture<Response> mkdir(String requestId, String path) {
        return CompletableFuture.supplyAsync(() -> {
            SafePathResolver.PathResult result = resolver.resolvePath(path);
            if (!result.isOk()) {
                return Response.fail(requestId, result.getStatus().name());
            }

            Path target = result.getTargetPath();
            if (Files.exists(target)) {
                return Response.fail(requestId, "ALREADY_EXISTS");
            }

            try {
                Files.createDirectories(target);
                return Response.ok(requestId, true);
            } catch (IOException e) {
                return Response.fail(requestId, "IO_ERROR");
            }
        }, ioExecutor);
    }

    public CompletableFuture<Response> rmdir(String requestId, String path) {
        return CompletableFuture.supplyAsync(() -> {
            SafePathResolver.PathResult result = resolver.resolvePath(path);
            if (!result.isOk()) {
                return Response.fail(requestId, result.getStatus().name());
            }

            Path target = result.getTargetPath();
            if (!Files.exists(target)) {
                return Response.fail(requestId, "NOT_FOUND");
            }
            if (!Files.isDirectory(target)) {
                return Response.fail(requestId, "NOT_DIRECTORY");
            }

            try {
                Files.delete(target);
                return Response.ok(requestId, true);
            } catch (DirectoryNotEmptyException e) {
                return Response.fail(requestId, "FORBIDDEN");
            } catch (IOException e) {
                return Response.fail(requestId, "IO_ERROR");
            }
        }, ioExecutor);
    }

    public CompletableFuture<Response> delete(String requestId, String path) {
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

            try {
                Files.delete(target);
                return Response.ok(requestId, true);
            } catch (IOException e) {
                return Response.fail(requestId, "IO_ERROR");
            }
        }, ioExecutor);
    }

    public CompletableFuture<Response> rename(String requestId, String sourcePath, String targetPath) {
        return CompletableFuture.supplyAsync(() -> {
            SafePathResolver.PathResult srcResult = resolver.resolvePath(sourcePath);
            if (!srcResult.isOk()) {
                return Response.fail(requestId, srcResult.getStatus().name());
            }

            SafePathResolver.PathResult destResult = resolver.resolvePath(targetPath);
            if (!destResult.isOk()) {
                return Response.fail(requestId, destResult.getStatus().name());
            }

            Path src = srcResult.getTargetPath();
            Path dest = destResult.getTargetPath();

            if (!Files.exists(src)) {
                return Response.fail(requestId, "NOT_FOUND");
            }

            try {
                Files.move(src, dest, StandardCopyOption.REPLACE_EXISTING);
                return Response.ok(requestId, true);
            } catch (IOException e) {
                return Response.fail(requestId, "IO_ERROR");
            }
        }, ioExecutor);
    }

    public CompletableFuture<Response> getDiskSpace(String requestId) {
        return CompletableFuture.supplyAsync(() -> {
            File rootFile = resolver.getRootPath().toFile();
            long totalBytes = rootFile.getTotalSpace();
            long usableBytes = rootFile.getUsableSpace();

            Map<String, Object> map = new HashMap<>();
            map.put("totalBytes", totalBytes);
            map.put("usableBytes", usableBytes);

            return Response.ok(requestId, map);
        }, ioExecutor);
    }
}
