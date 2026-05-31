"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

const TEMPLATE_JSON = `{
  "apiKey": "← from Firebase SDK config",
  "authDomain": "your-project.firebaseapp.com",
  "projectId": "your-project-id",
  "storageBucket": "your-project.appspot.com",
  "messagingSenderId": "123456789012",
  "appId": "1:123456789012:web:abc123def456"
}`;

export function SyncConfigTemplate() {
	const [copied, setCopied] = useState(false);

	function handleCopy() {
		void navigator.clipboard.writeText(TEMPLATE_JSON).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		});
	}

	return (
		<div>
			<div className="mb-1 flex items-center justify-between">
				<span className="text-xs font-medium text-muted-foreground">Template (all keys)</span>
				<Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={handleCopy}>
					{copied ? (
						<Check className="h-3.5 w-3.5" aria-hidden />
					) : (
						<Copy className="h-3.5 w-3.5" aria-hidden />
					)}
					{copied ? "Copied" : "Copy template"}
				</Button>
			</div>
			<pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">
				{TEMPLATE_JSON}
			</pre>
		</div>
	);
}
