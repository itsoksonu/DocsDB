import Head from "next/head";
import { DesktopNavbar } from "../components/layout/DesktopNavbar";
import Footer from "../components/layout/Footer";

export default function TermsOfService() {
  return (
    <>
      <Head>
        <title>Terms of Service - DocsDB</title>
        <meta name="description" content="Terms of Service for DocsDB" />
      </Head>

      <div className="min-h-screen bg-dark-950 text-white flex flex-col">
        <DesktopNavbar />

        <main className="flex-grow pt-32 px-6 pb-16">
          <div className="max-w-4xl mx-auto">
            <h1 className="text-4xl font-bold mb-8 bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
              Terms of Service
            </h1>

            <div className="space-y-8 text-dark-200 leading-relaxed">
              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">
                  1. Agreement to Terms
                </h2>
                <p>
                  By accessing or using DocsDB, you agree to be bound by these
                  Terms of Service and all applicable laws and regulations. If
                  you do not agree with any of these terms, you are prohibited
                  from using or accessing this site.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">
                  2. Use License
                </h2>
                <p className="mb-4">
                  Permission is granted to temporarily download one copy of the
                  materials (information or software) on DocsDB's website for
                  personal, non-commercial transitory viewing only. This is the
                  grant of a license, not a transfer of title, and under this
                  license you may not:
                </p>
                <ul className="list-disc pl-6 space-y-2">
                  <li>modify or copy the materials;</li>
                  <li>
                    use the materials for any commercial purpose, or for any
                    public display (commercial or non-commercial);
                  </li>
                  <li>
                    attempt to decompile or reverse engineer any software
                    contained on DocsDB's website;
                  </li>
                  <li>
                    remove any copyright or other proprietary notations from the
                    materials; or
                  </li>
                  <li>
                    transfer the materials to another person or "mirror" the
                    materials on any other server.
                  </li>
                </ul>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">
                  3. User Content
                </h2>
                <p>
                  You retain ownership of any documents or content you upload to
                  DocsDB. However, by uploading content, you grant DocsDB a
                  worldwide, non-exclusive, royalty-free license to use,
                  reproduce, modify, adapt, publish, translate, create
                  derivative works from, distribute, and display such content in
                  connection with providing and improving our services.
                </p>
                <p className="mt-4">
                  You represent and warrant that you own or have the necessary
                  rights to the content you upload and that your content does
                  not violate any third-party rights.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">
                  4. Disclaimer
                </h2>
                <p>
                  The materials on DocsDB's website are provided on an 'as is'
                  basis. DocsDB makes no warranties, expressed or implied, and
                  hereby disclaims and negates all other warranties including,
                  without limitation, implied warranties or conditions of
                  merchantability, fitness for a particular purpose, or
                  non-infringement of intellectual property or other violation
                  of rights.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">
                  5. Limitations
                </h2>
                <p>
                  In no event shall DocsDB or its suppliers be liable for any
                  damages (including, without limitation, damages for loss of
                  data or profit, or due to business interruption) arising out
                  of the use or inability to use the materials on DocsDB's
                  website, even if DocsDB or a DocsDB authorized representative
                  has been notified orally or in writing of the possibility of
                  such damage.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">
                  6. Governing Law
                </h2>
                <p>
                  These terms and conditions are governed by and construed in
                  accordance with the laws and you irrevocably submit to the
                  exclusive jurisdiction of the courts in that location.
                </p>
              </section>

              <section>
                <p className="text-sm text-dark-400 mt-8">
                  Last Updated: {new Date().toLocaleDateString()}
                </p>
              </section>
            </div>
          </div>
        </main>

        <Footer />
      </div>
    </>
  );
}
