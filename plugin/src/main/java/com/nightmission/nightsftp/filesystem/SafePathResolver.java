package com.nightmission.nightsftp.filesystem;

import java.io.File;
import java.io.IOException;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.Paths;

public class SafePathResolver {

    public enum ValidationResultStatus {
        OK,
        INVALID_PATH,
        ROOT_ESCAPE,
        NOT_FOUND
    }

    public static class PathResult {
        private final ValidationResultStatus status;
        private final Path targetPath;
        private final String relativePath;

        public PathResult(ValidationResultStatus status, Path targetPath, String relativePath) {
            this.status = status;
            this.targetPath = targetPath;
            this.relativePath = relativePath;
        }

        public ValidationResultStatus getStatus() {
            return status;
        }

        public Path getTargetPath() {
            return targetPath;
        }

        public String getRelativePath() {
            return relativePath;
        }

        public boolean isOk() {
            return status == ValidationResultStatus.OK;
        }
    }

    private final Path rootPath;

    public SafePathResolver(File serverRootDir) {
        if (serverRootDir == null) {
            serverRootDir = new File(".").getAbsoluteFile();
        }
        Path root = serverRootDir.toPath().toAbsolutePath().normalize();
        try {
            if (serverRootDir.exists()) {
                root = serverRootDir.toPath().toRealPath();
            }
        } catch (IOException ignored) {
        }
        this.rootPath = root;
    }


    public Path getRootPath() {
        return rootPath;
    }

    /**
     * Resolves a user-supplied relative or absolute path safety against the server root.
     * Prevents path traversal, absolute path injection, and symlink escape.
     */
    public PathResult resolvePath(String rawPath) {
        if (rawPath == null) {
            return new PathResult(ValidationResultStatus.INVALID_PATH, null, null);
        }

        // Clean leading slashes / backslashes
        String cleanPath = rawPath.trim();
        
        // Remove trailing null bytes or URL encoding tricks if present
        cleanPath = cleanPath.replaceAll("\0", "");
        
        if (cleanPath.startsWith("/") || cleanPath.startsWith("\\")) {
            cleanPath = cleanPath.substring(1);
        }

        Path resolved;
        try {
            resolved = rootPath.resolve(cleanPath).normalize();
        } catch (Exception e) {
            return new PathResult(ValidationResultStatus.INVALID_PATH, null, null);
        }

        // Verify resolved path stays under root
        if (!resolved.startsWith(rootPath)) {
            return new PathResult(ValidationResultStatus.ROOT_ESCAPE, null, null);
        }

        // Check symlink real path if file exists
        if (java.nio.file.Files.exists(resolved, LinkOption.NOFOLLOW_LINKS)) {
            try {
                Path realPath = resolved.toRealPath();
                if (!realPath.startsWith(rootPath)) {
                    return new PathResult(ValidationResultStatus.ROOT_ESCAPE, null, null);
                }
            } catch (IOException e) {
                return new PathResult(ValidationResultStatus.INVALID_PATH, null, null);
            }
        } else {
            // For non-existent files (e.g. creating new file or directory), verify parent folder real path
            Path parent = resolved.getParent();
            if (parent != null && java.nio.file.Files.exists(parent)) {
                try {
                    Path parentReal = parent.toRealPath();
                    if (!parentReal.startsWith(rootPath)) {
                        return new PathResult(ValidationResultStatus.ROOT_ESCAPE, null, null);
                    }
                } catch (IOException e) {
                    return new PathResult(ValidationResultStatus.INVALID_PATH, null, null);
                }
            }
        }

        Path rel = rootPath.relativize(resolved);
        String relStr = rel.toString().replace('\\', '/');
        if (relStr.isEmpty()) {
            relStr = ".";
        }

        return new PathResult(ValidationResultStatus.OK, resolved, relStr);
    }
}
