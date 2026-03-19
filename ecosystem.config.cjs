module.exports = {
    apps: [{
        name: 'poly-bot',
        script: 'npx',
        args: 'tsx src/server.ts',
        cwd: __dirname,
        env: {
            NODE_ENV: 'production',
            POLY_MULTI_PORT: '3020',
        },
    }],
};
