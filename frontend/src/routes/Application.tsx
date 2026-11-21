import ApplicationForm from "@/components/ApplicationForm";
import { useParams } from "react-router";
import { useEffect, useState } from "react";

import type {
    Application,
} from "../types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import ErrorAlert from "@/components/ErrorAlert";
import { fakeApplications } from "@/lib/testpayloads";
import { responseError } from "@/lib/response-error";
import styles from "@/styles/Application.module.css";


export default function Application({mock = false}) {
    const { id } = useParams();

    const [application, setApplication] = useState<Application | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);

    useEffect(() => {
        let active = true;
        setApplication(null);
        setLoadError(null);
        setLoading(!!id);

        async function loadApplication() {
            try {
                const response = await fetch(`/api/v1/applications/${id}`, {
                    credentials: "include",
                });
                if (!response.ok) {
                    throw await responseError(response, response.status === 404
                        ? "Application not found."
                        : "Error loading application.");
                }
                const data = await response.json() as Application;
                if (active) setApplication(data);
            } catch (error) {
                if (active) setLoadError(error instanceof Error ? error.message : "Error loading application.");
            } finally {
                if (active) setLoading(false);
            }
        }

        if (mock) {
            setApplication(fakeApplications.find((app) => app.id === id) || null);
            setLoading(false);
        } else if (id) {
            loadApplication();
        } else {
            setLoading(false);
        }

        return () => { active = false; };
    }, [id, mock]);

    if (loading) return (
        <div className={styles.messageContainer}>
            <Alert className={styles.alert}>
                <AlertDescription>{"Loading application details..."}</AlertDescription>
            </Alert>
        </div>
    );

    if (loadError) return (
        <div className={styles.messageContainer}>
            <ErrorAlert message={loadError} className={`${styles.alert} ${styles.errorText}`} />
        </div>
    );


    if (id && !application) return (
        <div className={styles.messageContainer}>
            <Alert className={styles.alert}>
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
