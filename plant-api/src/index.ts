import "dotenv/config"
import express from "express"
import helmet from "helmet"
import pinoHttp from "pino-http"
import { healthRouter } from "./routes/health"
import { errorHandler } from "./middleware/errors"

export function createApp() {  
    const app = express(); 
    //secuirty headers on every resp , close off a bunch of common header based web vulnerabilities on call
    app.use(helmet());  
    //structured json req logs in req.log, Auto-logs method/url/status/response-time per request, generates a request id
    app.use(pinoHttp()); 
    app.use(express.json({ limit: "5mb" }));

    app.use("/v1", healthRouter)

    app.use((_req, res) =>{
        res.status(404).json({error : {code: 'not_found', message: "Route not found"}
        })
    })

    app.use(errorHandler)

    return app;
}

if (require.main === module){
    const app = createApp()
    const port = Number(process.env.PORT) || 8000;

    app.listen(port, ()=>{
        console.log(`plantapi listening on port ${port}`)
    })
}