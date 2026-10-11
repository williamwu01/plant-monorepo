import express from "express";
//middleware for cunstom security 
export const errorHandler = ((err: Error, req:express.Request, res: express.Response, _next: express.NextFunction)=>
        {
        req.log.error(err);
        res.status(500).json({error:{code: "internal_error", message: "something went wrong"}})
    })