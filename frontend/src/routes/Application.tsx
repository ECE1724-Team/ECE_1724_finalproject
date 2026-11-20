import ApplicationForm from "@/components/ApplicationForm";
import { useParams } from "react-router";
import { useEffect, useState } from "react";

import type {
    Application,
} from "../types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { fakeApplications } from "@/lib/testpayloads";


export default function Application({mock = false}) {
    const { id } = useParams();

    const [application, setApplication] = useState<Application | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);

    useEffect(() => {
        async function loadApplication() {
            try {
                const response = await fetch(`/api/v1/applications/${id}`, {
                    credentials: "include",
                });
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

        if (mock) {
            setApplication(fakeApplications.find((app) => app.id === id) || null);
            setLoading(false);
            return;
        }

        if(id){
            loadApplication();
        }else{
            setLoading(false);
        }
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


    if (id && !application) return (
        <div className="mx-auto grid max-w-2xl gap-5 rounded-lg p-6">
            <Alert className="rounded-md py-2">
                <AlertDescription>{"Application not found"}</AlertDescription>
            </Alert>
        </div>
    );

    return (<>
        <div>
            <ApplicationForm application={application ?? undefined} mock={mock} />
        </div>
    </>
    );
}
