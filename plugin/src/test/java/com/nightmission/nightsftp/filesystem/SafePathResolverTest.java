package com.nightmission.nightsftp.filesystem;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

public class SafePathResolverTest {

    @TempDir
    Path tempRootDir;

    private SafePathResolver resolver;

    @BeforeEach
    public void setUp() throws IOException {
        resolver = new SafePathResolver(tempRootDir.toFile());
        Files.createDirectories(tempRootDir.resolve("plugins"));
        Files.createFile(tempRootDir.resolve("server.jar"));
    }

    @Test
    public void testValidRelativePath() {
        SafePathResolver.PathResult res = resolver.resolvePath("plugins/config.yml");
        assertTrue(res.isOk());
        assertEquals(SafePathResolver.ValidationResultStatus.OK, res.getStatus());
    }

    @Test
    public void testPathTraversalAttempt() {
        SafePathResolver.PathResult res = resolver.resolvePath("../../etc/passwd");
        assertFalse(res.isOk());
        assertEquals(SafePathResolver.ValidationResultStatus.ROOT_ESCAPE, res.getStatus());
    }

    @Test
    public void testNestedTraversalAttempt() {
        SafePathResolver.PathResult res = resolver.resolvePath("plugins/../../etc/shadow");
        assertFalse(res.isOk());
        assertEquals(SafePathResolver.ValidationResultStatus.ROOT_ESCAPE, res.getStatus());
    }

    @Test
    public void testAbsolutePathAttempt() {
        SafePathResolver.PathResult res = resolver.resolvePath("/etc/passwd");
        // Leading slashes are stripped and resolved against root, if it resolves outside root it fails
        SafePathResolver.PathResult res2 = resolver.resolvePath("C:\\Windows\\System32");
        assertFalse(res2.isOk());
        assertEquals(SafePathResolver.ValidationResultStatus.ROOT_ESCAPE, res2.getStatus());
    }

    @Test
    public void testNullOrEmptyPath() {
        SafePathResolver.PathResult res = resolver.resolvePath(null);
        assertFalse(res.isOk());
        assertEquals(SafePathResolver.ValidationResultStatus.INVALID_PATH, res.getStatus());
    }
}
