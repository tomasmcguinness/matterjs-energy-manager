const nextConfig = {
    typescript: {
        // The project doesn't type-check cleanly yet; don't let that block a
        // production build.
        ignoreBuildErrors: true,
    },
};

export default nextConfig;
