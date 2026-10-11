import "dotenv/config"
import express from "express"
import helmet from "helmet"
import pinoHttp from "pino-http"
import { healthRouter } from "./routes/health"

export function createApp() {  
    const app = express(); 

    app.use(helmet());  
    app.use(pinoHttp()); 
    app.use(express.json({ limit: "5mb" }));

    app.use("/v1", healthRouter)

    app.use((_req, res) =>{
        res.status(404).json({error : {code: 'not_found', message: "Route not found"}
        })
    })

    return app;
}