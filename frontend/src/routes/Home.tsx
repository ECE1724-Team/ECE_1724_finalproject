import { BriefcaseBusiness, FileText, ListChecks } from "lucide-react";
import { Link } from "react-router";
import { useAuth } from "@/components/AuthProvider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import styles from "@/styles/Home.module.css";

export default function Home() {
  const { status } = useAuth();

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <p className={styles.eyebrow}>Welcome to JobFlo.AI</p>
        <h1 className={styles.title}>A clearer way to manage your job search.</h1>
        <p className={styles.intro}>
          JobFlo.AI helps you organize your applications, keep your resumes close,
          and stay on top of your progress in one place.
        </p>
        <Button
          nativeButton={false}
          render={<Link to={status === "authenticated" ? "/applications" : "/login"} />}
        >
          {status === "authenticated" ? "View applications" : "Sign in or register"}
        </Button>
      </section>

      <section aria-labelledby="features-heading" className={styles.features}>
        <div>
          <h2 id="features-heading" className={styles.sectionTitle}>Your job search, organized</h2>
          <p className={styles.sectionDescription}>
            Keep the details you need together as you move from saved roles to offers.
          </p>
        </div>
        <div className={styles.featureGrid}>
          <Card>
            <CardHeader>
              <BriefcaseBusiness aria-hidden="true" className={styles.icon} />
              <CardTitle>Track applications</CardTitle>
            </CardHeader>
            <CardContent className={styles.featureDescription}>
              Save roles and follow their status throughout your job search.
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <FileText aria-hidden="true" className={styles.icon} />
              <CardTitle>Manage resumes</CardTitle>
            </CardHeader>
            <CardContent className={styles.featureDescription}>
              Upload resumes and link the right one to each application.
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <ListChecks aria-hidden="true" className={styles.icon} />
              <CardTitle>Keep details together</CardTitle>
            </CardHeader>
            <CardContent className={styles.featureDescription}>
              Store job information, notes, and interview details with each role.
            </CardContent>
          </Card>
        </div>
        <p className={styles.sectionDescription}>AI preparation features are in development.</p>
      </section>
    </main>
  );
}
