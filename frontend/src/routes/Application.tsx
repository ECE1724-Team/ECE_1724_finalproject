import ApplicationForm from "@/components/ApplicationForm";
import NavBar from "@/components/NavBar";
import { useParams } from "react-router";
import { useEffect, useState } from "react";

import type {
    Application,
} from "../types";
import { Alert, AlertDescription } from "@/components/ui/alert";


export default function Application() {
    const { id } = useParams();

    const [application, setApplication] = useState<Application | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);

    useEffect(() => {
        async function loadApplication() {
            try {
                const response = await fetch(`/api/applications/${id}`);
                if (response.status === 404) {
                    return;
                }
                if (!response.ok) {
                    throw new Error();
                }
                const data = await response.json() as Application;
                setApplication(data);
            } catch {
                setLoadError(true);
            } finally {
                setLoading(false);
            }
        }

        loadApplication();
    }, [id]);

    if (loading) return (
        <div className="mx-auto grid max-w-2xl gap-5 rounded-lg p-6">
            <Alert className="rounded-md py-2">
                <AlertDescription>{"Loading application details..."}</AlertDescription>
            </Alert>
        </div>
    );
    
    if (loadError) return (
        <div className="mx-auto grid max-w-2xl gap-5 rounded-lg p-6">
            <Alert variant="destructive" className="rounded-md py-2 text-red-700">
                <AlertDescription>{"Error loading application"}</AlertDescription>
            </Alert>
        </div>
    );


    if (!application) return (
        <div className="mx-auto grid max-w-2xl gap-5 rounded-lg p-6">
            <Alert className="rounded-md py-2">
                <AlertDescription>{"Application not found"}</AlertDescription>
            </Alert>
        </div>
    );

    return (<>
        <NavBar currentLocation="/applications" />
        <div>
            <h1>Application</h1>
            <ApplicationForm />
        </div>
    </>
    );
}
